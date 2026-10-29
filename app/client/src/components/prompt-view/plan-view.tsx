import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, Circle, CircleDashed, Info, Loader2 } from 'lucide-react'
import { buildPlan, type PlanStep, type StepStatus } from '@/lib/plan'
import type { TurnNode } from '@/lib/turn-tree'
import { formatDuration } from '@/components/settings/session-modal'
import { useAssistantMessages } from './conversation-view'
import { nodeTitle, statusLabel } from './turn-tree-panel'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
  if (status === 'in_progress')
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
}

function stepMeta(step: PlanStep, now: number): string {
  const parts: string[] = []
  if (step.toolCount > 0) parts.push(t('{n} tools', { n: step.toolCount }))
  if (step.startedAt !== null) {
    parts.push(formatDuration(Math.max(0, (step.endedAt ?? now) - step.startedAt)))
  }
  if (step.errorCount > 0) parts.push(t('{n} errors', { n: step.errorCount }))
  return parts.join(' · ')
}

/**
 * Plan tab: the prompt's steps (from Claude's task list, or its replies as
 * a fallback), what ran under each — tool calls and subagents — and
 * overall progress.
 */
export function PlanView({
  sessionId,
  node,
  output,
  onSelectNode,
}: {
  sessionId: string
  node: TurnNode
  output: string | null
  /** Open a subagent in the prompt view. */
  onSelectNode: (id: string) => void
}) {
  const replies = useAssistantMessages(sessionId, node, output)
  const plan = useMemo(() => buildPlan(node, replies ?? []), [node, replies])

  const running = node.endedAt === null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const elapsed = formatDuration(Math.max(0, (node.endedAt ?? now) - node.startedAt))
  const pct = plan.progress === null ? null : Math.round(plan.progress * 100)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 text-xs">
      {/* Overall progress */}
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium">{t('Progress')}</span>
          <span className="text-muted-foreground tabular-nums">
            {pct !== null
              ? t('{done}/{total} steps · {pct}%', {
                  done: plan.completed,
                  total: plan.total,
                  pct,
                })
              : t('{n} steps so far', { n: plan.steps.length })}
            {' · '}
            {elapsed}
            {' · '}
            {statusLabel(node.status)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              node.status === 'failed' ? 'bg-red-500' : running ? 'bg-blue-500' : 'bg-green-500',
              pct === null && running && 'animate-pulse',
            )}
            style={{ width: `${pct ?? 100}%`, opacity: pct === null ? 0.35 : 1 }}
          />
        </div>
      </div>

      {plan.source !== 'tasks' && plan.source !== 'todos' && (
        <div className="mb-3 flex gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {plan.source === 'replies'
              ? t(
                  "Claude didn't keep a task list for this prompt, so each reply is shown as a step and the total is unknown.",
                )
              : t('No plan yet. Steps appear once Claude starts working.')}
          </span>
        </div>
      )}

      {/* Steps */}
      <ol className="space-y-1">
        {plan.steps.map((step, i) => (
          <li
            key={step.id}
            className={cn(
              'rounded-md border px-2 py-1.5',
              step.status === 'in_progress'
                ? 'border-blue-500/40 bg-blue-500/5'
                : 'border-border/60',
            )}
          >
            <div className="flex items-start gap-2">
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'break-words',
                    step.status === 'completed' && 'text-muted-foreground',
                    step.status === 'in_progress' && 'font-medium',
                  )}
                >
                  <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}.</span>
                  {step.status === 'in_progress' && step.activeForm ? step.activeForm : step.title}
                </div>
                {(stepMeta(step, now) || step.subagents.length > 0) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {stepMeta(step, now) && (
                      <span
                        className={cn('tabular-nums', step.errorCount > 0 && 'text-red-500/80')}
                      >
                        {stepMeta(step, now)}
                      </span>
                    )}
                    {step.subagents.map((sub) => (
                      <SubagentChip key={sub.id} node={sub} onClick={() => onSelectNode(sub.id)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {(plan.unassigned.toolCount > 0 || plan.unassigned.subagents.length > 0) &&
        plan.steps.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 px-2 text-[10px] text-muted-foreground">
            <CircleDashed className="h-3.5 w-3.5" />
            <span>
              {t('Outside any step')}
              {plan.unassigned.toolCount > 0 &&
                ` · ${t('{n} tools', { n: plan.unassigned.toolCount })}`}
            </span>
            {plan.unassigned.subagents.map((sub) => (
              <SubagentChip key={sub.id} node={sub} onClick={() => onSelectNode(sub.id)} />
            ))}
          </div>
        )}
    </div>
  )
}

function SubagentChip({ node, onClick }: { node: TurnNode; onClick: () => void }) {
  const done = node.status === 'done'
  return (
    <button
      type="button"
      className="flex max-w-[16rem] items-center gap-1 rounded bg-violet-500/10 px-1.5 py-px text-violet-700 hover:bg-violet-500/20 dark:text-violet-300 cursor-pointer"
      onClick={onClick}
      title={`${nodeTitle(node)} — ${statusLabel(node.status)}`}
    >
      <Bot className="h-3 w-3 shrink-0" />
      <span className="truncate">{node.agentType ?? nodeTitle(node)}</span>
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          done ? 'bg-muted-foreground/40' : 'animate-pulse bg-green-500',
        )}
      />
    </button>
  )
}
