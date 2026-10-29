import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, MessageSquare, Settings2 } from 'lucide-react'
import type { TurnNode, TurnStatus } from '@/lib/turn-tree'
import { buildPlan } from '@/lib/plan'
import { formatDuration } from '@/components/settings/session-modal'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STATUS_DOT: Record<TurnStatus, string> = {
  running: 'bg-green-500 animate-pulse',
  waiting: 'bg-amber-500 animate-pulse',
  done: 'bg-muted-foreground/40',
  failed: 'bg-red-500',
  interrupted: 'bg-muted-foreground/20 ring-1 ring-muted-foreground/40',
}

export function statusLabel(status: TurnStatus): string {
  switch (status) {
    case 'running':
      return t('Running')
    case 'waiting':
      return t('Waiting for input')
    case 'done':
      return t('Done')
    case 'failed':
      return t('Failed')
    case 'interrupted':
      return t('Interrupted')
  }
}

export function nodeTitle(node: TurnNode): string {
  if (node.title) return node.title
  if (node.kind === 'subagent') return t('Subagent')
  if (node.kind === 'prompt') return t('(empty prompt)')
  return t('Session event')
}

/** "12 tools · 2m 4s · 1 error" — duration runs live while the node is open. */
export function nodeMeta(node: TurnNode, now: number): string {
  const parts: string[] = []
  if (node.kind !== 'system') parts.push(t('{n} tools', { n: node.toolCount }))
  if (node.kind !== 'system' || node.endedAt !== node.startedAt) {
    parts.push(formatDuration(Math.max(0, (node.endedAt ?? now) - node.startedAt)))
  }
  if (node.errorCount > 0) parts.push(t('{n} errors', { n: node.errorCount }))
  return parts.join(' · ')
}

/** "3/4" for prompts whose plan comes from a real task list. */
function PlanBadge({ node }: { node: TurnNode }) {
  const plan = useMemo(() => (node.kind === 'prompt' ? buildPlan(node) : null), [node])
  if (!plan || plan.progress === null) return null
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 tabular-nums',
        plan.progress === 1
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      )}
      title={t('{done}/{total} steps done', { done: plan.completed, total: plan.total })}
    >
      {plan.completed}/{plan.total}
    </span>
  )
}

function hasRunning(nodes: TurnNode[]): boolean {
  return nodes.some(
    (n) => n.status === 'running' || n.status === 'waiting' || hasRunning(n.children),
  )
}

function Row({
  node,
  depth,
  selectedId,
  onSelect,
  now,
}: {
  node: TurnNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  now: number
}) {
  const [open, setOpen] = useState(true)
  const Icon = node.kind === 'prompt' ? MessageSquare : node.kind === 'subagent' ? Bot : Settings2
  const selected = node.id === selectedId
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        data-turn-node={node.id}
        className={cn(
          'group flex items-start gap-1.5 rounded-md py-1.5 pr-2 cursor-pointer text-xs',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          node.kind === 'system' && 'text-muted-foreground',
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(node.id)
          }
        }}
      >
        <button
          type="button"
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground',
            node.children.length === 0 && 'invisible',
          )}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          aria-label={open ? t('Collapse') : t('Expand')}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <Icon
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            node.kind === 'subagent' ? 'text-violet-500' : 'text-muted-foreground',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {node.kind !== 'system' && (
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[node.status])}
                title={statusLabel(node.status)}
              />
            )}
            <span className={cn('truncate', node.kind === 'prompt' && 'font-medium')}>
              {nodeTitle(node)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {node.agentType && node.kind === 'subagent' && node.title !== node.agentType && (
              <span className="rounded bg-violet-500/10 px-1 text-violet-600 dark:text-violet-400">
                {node.agentType}
              </span>
            )}
            <span className={cn('truncate tabular-nums', node.errorCount > 0 && 'text-red-500/80')}>
              {nodeMeta(node, now)}
            </span>
            <PlanBadge node={node} />
          </div>
        </div>
      </div>
      {open &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            now={now}
          />
        ))}
    </div>
  )
}

export function TurnTreePanel({
  roots,
  selectedId,
  onSelect,
}: {
  roots: TurnNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // Tick once a second only while something is running, for live durations.
  const running = hasRunning(roots)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  // Keep the selected row visible when it's picked from elsewhere (waterfall).
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = panelRef.current?.querySelector(`[data-turn-node="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (roots.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">{t('No prompts yet')}</div>
  }
  return (
    <div ref={panelRef} className="space-y-0.5 p-1.5">
      {roots.map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          now={now}
        />
      ))}
    </div>
  )
}
