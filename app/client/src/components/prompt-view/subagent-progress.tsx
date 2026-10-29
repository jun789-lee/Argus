import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api-client'
import { buildPlan } from '@/lib/plan'
import { estimateProgress, samplesFor, stallThresholdMs, type Estimate } from '@/lib/eta'
import type { TurnNode } from '@/lib/turn-tree'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { formatDuration } from '@/components/settings/session-modal'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function useSubagentRunStats() {
  return useQuery({
    queryKey: ['subagent-run-stats'],
    queryFn: () => api.getSubagentRunStats(),
    // History changes only when a subagent finishes; a minute is plenty.
    staleTime: 60_000,
  })
}

export interface NodeProgress {
  /** 'plan': steps done / total. 'estimate': learned from past runs. */
  kind: 'plan' | 'estimate' | 'none'
  progress: number | null
  planDone?: number
  planTotal?: number
  estimate?: Estimate | null
  /** Estimate compared against this agent type, or all subagents. */
  scope?: 'type' | 'all'
  lastEventAt: number
  stalled: boolean
}

/** Best available progress for a running node, plus liveness. */
export function useNodeProgress(node: TurnNode, now: number): NodeProgress {
  const { data: stats } = useSubagentRunStats()
  return useMemo(() => {
    const plan = buildPlan(node)
    const samples = node.kind === 'subagent' ? samplesFor(stats, node.agentType) : null
    const estimate = samples ? estimateProgress(now - node.startedAt, samples.durations) : null
    const stalled = now - node.lastEventAt > stallThresholdMs(estimate?.typicalMs ?? null)
    if (plan.progress !== null) {
      return {
        kind: 'plan',
        progress: plan.progress,
        planDone: plan.completed,
        planTotal: plan.total,
        estimate,
        scope: samples?.scope,
        lastEventAt: node.lastEventAt,
        stalled,
      }
    }
    return {
      kind: estimate ? 'estimate' : 'none',
      progress: estimate?.progress ?? null,
      estimate,
      scope: samples?.scope,
      lastEventAt: node.lastEventAt,
      stalled,
    }
  }, [node, stats, now])
}

/** "~40%" / "2/4" — for tight spots like the tree row and plan chips. */
export function progressShort(p: NodeProgress): string | null {
  if (p.kind === 'plan') return `${p.planDone}/${p.planTotal}`
  if (p.kind === 'estimate' && p.estimate) {
    return p.estimate.overdue ? t('overdue') : `~${Math.round(p.estimate.progress * 100)}%`
  }
  return null
}

function ago(ms: number): string {
  return ms < 5_000 ? t('just now') : t('{time} ago', { time: formatDuration(ms) })
}

/**
 * Full progress block for a running subagent: bar (plan- or history-based),
 * the estimate's basis, and liveness — what it's doing now and whether it
 * has gone quiet.
 */
export function SubagentProgress({ node, now }: { node: TurnNode; now: number }) {
  const p = useNodeProgress(node, now)

  const pct = p.progress === null ? null : Math.round(p.progress * 100)
  const est = p.estimate
  const basis =
    p.kind === 'plan'
      ? t('Plan {done}/{total} steps', { done: p.planDone ?? 0, total: p.planTotal ?? 0 })
      : est
        ? est.overdue
          ? t('Running longer than usual (typically {typical})', {
              typical: formatDuration(est.typicalMs),
            })
          : t('Estimate · about {left} left · typical {typical}', {
              left: formatDuration(est.remainingMs),
              typical: formatDuration(est.typicalMs),
            })
        : t('Not enough history to estimate yet')
  const sampleNote =
    est && p.kind === 'estimate'
      ? p.scope === 'type'
        ? t('based on {n} past {type} runs', { n: est.samples, type: node.agentType ?? '' })
        : t('based on {n} past subagent runs', { n: est.samples })
      : null

  return (
    <div className="mb-3 space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-medium">
          {pct !== null ? `${p.kind === 'estimate' ? '~' : ''}${pct}%` : '—'}
        </span>
        <span className="text-muted-foreground">{basis}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            p.kind === 'plan' ? 'bg-blue-500' : 'bg-violet-500/70',
            pct === null && 'w-full animate-pulse opacity-30',
            est?.overdue && 'bg-amber-500',
          )}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {sampleNote && <div className="text-[10px] text-muted-foreground/70">{sampleNote}</div>}
      <LivenessLine node={node} now={now} stalled={p.stalled} />
    </div>
  )
}

/**
 * "Now: Bash npm test · 3s ago" — or a warning when a running node has
 * gone quiet for longer than usual.
 */
export function LivenessLine({
  node,
  now,
  stalled,
}: {
  node: TurnNode
  now: number
  stalled: boolean
}) {
  const { events: enriched } = useProcessedEvents()
  const last = useMemo(() => {
    const ids = new Set(node.events.map((e) => e.id))
    let best = null as (typeof enriched)[number] | null
    for (const e of enriched) {
      if (!ids.has(e.id) || !e.displayEventStream) continue
      if (!best || e.timestamp >= best.timestamp) best = e
    }
    return best
  }, [enriched, node.events])
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-[11px]',
        stalled ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
      )}
    >
      {stalled && <AlertTriangle className="h-3 w-3 shrink-0" />}
      <span className="truncate">
        {stalled
          ? t('No activity for {time}', { time: formatDuration(now - node.lastEventAt) })
          : last
            ? t('Now: {what}', {
                what: `${last.toolName || last.label}${last.summary ? ` ${last.summary}` : ''}`,
              })
            : t('Starting…')}
      </span>
      {!stalled && <span className="shrink-0 tabular-nums">· {ago(now - node.lastEventAt)}</span>}
    </div>
  )
}

/** Compact progress next to a running subagent (tree row, plan chips). */
export function ProgressBadge({ node, now }: { node: TurnNode; now: number }) {
  const p = useNodeProgress(node, now)
  const text = progressShort(p)
  if (p.stalled) {
    return (
      <span className="shrink-0 text-amber-600 dark:text-amber-400" title={t('No recent activity')}>
        ⚠
      </span>
    )
  }
  if (!text) return null
  return (
    <span
      className={cn(
        'shrink-0 tabular-nums',
        p.estimate?.overdue
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-violet-600 dark:text-violet-400',
      )}
      title={p.kind === 'estimate' ? t('Estimated from past runs') : t('From the task list')}
    >
      {text}
    </span>
  )
}
