import { useEffect, useMemo, useState } from 'react'
import { Bot, MessageSquare } from 'lucide-react'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useUIStore } from '@/stores/ui-store'
import { buildTurnTree, type TurnNode, type TurnStatus } from '@/lib/turn-tree'
import { fitSession, layoutWaterfall, type WaterfallRow } from '@/lib/waterfall'
import { nodeMeta, nodeTitle, statusLabel } from '@/components/prompt-view/turn-tree-panel'
import { formatDuration } from '@/components/settings/session-modal'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const BAR_COLOR: Record<TurnStatus, string> = {
  running: 'bg-green-500/70',
  waiting: 'bg-amber-500/70',
  background: 'bg-violet-500/30',
  done: '',
  failed: 'bg-red-500/70',
  interrupted: 'bg-muted-foreground/25',
}

function barColor(row: WaterfallRow): string {
  if (row.status !== 'done') return BAR_COLOR[row.status]
  return row.node.kind === 'subagent' ? 'bg-violet-500/50' : 'bg-primary/40'
}

/**
 * Waterfall of the session's prompts and subagents: one bar per turn on a
 * shared time axis, subagents indented under the prompt that spawned
 * them, tool calls as ticks. Clicking a row opens it in the prompt view.
 */
export function WaterfallView({
  sessionId,
  rangeMs,
  fit,
  compact,
}: {
  sessionId: string
  /** Width of the sliding window ending now (ignored when `fit`). */
  rangeMs: number
  /** Show the whole session instead of the last `rangeMs`. */
  fit: boolean
  /** Prompts only; subagents folded into a count. */
  compact: boolean
}) {
  const { data: rawEvents } = useEffectiveEvents(sessionId)
  const roots = useMemo(() => buildTurnTree(rawEvents ?? [], { sessionId }), [rawEvents, sessionId])
  const selectedTurn = useUIStore((s) => s.selectedTurn)
  const setSelectedTurn = useUIStore((s) => s.setSelectedTurn)
  const setStreamView = useUIStore((s) => s.setStreamView)

  // Slide the window (and grow running bars) once a second.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const win = fit ? fitSession(roots, now) : { from: now - rangeMs, to: now }
  const layout = layoutWaterfall(roots, { ...win, now, compact })
  const selectedId = selectedTurn?.sessionId === sessionId ? selectedTurn.id : null

  const open = (node: TurnNode) => {
    setSelectedTurn({ sessionId, id: node.id })
    setStreamView('prompts')
  }

  if (layout.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {fit ? t('No agent activity') : t('No activity in this time range')}
      </div>
    )
  }

  return (
    <div className="px-2 py-1 text-[11px]">
      <div className="mb-0.5 flex pl-[188px] text-[9px] tabular-nums text-muted-foreground/70">
        <span>
          {fit ? new Date(layout.from).toLocaleTimeString() : `-${formatDuration(rangeMs)}`}
        </span>
        <span className="ml-auto">{fit ? formatDuration(layout.to - layout.from) : t('now')}</span>
      </div>
      {layout.rows.map((row) => {
        const { node } = row
        const Icon = node.kind === 'subagent' ? Bot : MessageSquare
        const selected = node.id === selectedId
        const tip = [
          nodeTitle(node),
          `${statusLabel(node.status)} · ${nodeMeta(node, now)}`,
          row.hiddenChildren > 0 ? t('{n} subagents', { n: row.hiddenChildren }) : null,
        ]
          .filter(Boolean)
          .join('\n')
        return (
          <div
            key={node.id}
            role="button"
            tabIndex={0}
            className={cn(
              'group flex h-5 cursor-pointer items-center rounded',
              selected ? 'bg-accent' : 'hover:bg-accent/40',
            )}
            onClick={() => open(node)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                open(node)
              }
            }}
            title={tip}
          >
            <div
              className="flex w-[188px] shrink-0 items-center gap-1 pr-2"
              style={{ paddingLeft: row.depth * 12 }}
            >
              <Icon
                className={cn(
                  'h-3 w-3 shrink-0',
                  node.kind === 'subagent' ? 'text-violet-500' : 'text-muted-foreground',
                )}
              />
              <span className="truncate">{nodeTitle(node)}</span>
              {row.hiddenChildren > 0 && (
                <span className="shrink-0 rounded bg-violet-500/10 px-1 text-[9px] text-violet-600 dark:text-violet-400">
                  +{row.hiddenChildren}
                </span>
              )}
            </div>
            <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted/30">
              <div
                className={cn(
                  'absolute inset-y-0',
                  barColor(row),
                  row.status === 'running' && 'animate-pulse',
                  row.clippedStart ? 'rounded-r-sm' : 'rounded-sm',
                  selected && 'ring-1 ring-foreground/60',
                )}
                style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%` }}
              />
              {row.ticks.map((tick, i) => (
                <span
                  key={i}
                  className={cn(
                    'absolute inset-y-0.5 w-px',
                    tick.failed ? 'bg-red-600' : 'bg-foreground/45',
                  )}
                  style={{ left: `${tick.pct}%` }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
