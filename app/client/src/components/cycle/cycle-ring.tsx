import type { CycleModel, StageKey, StageStatus } from '@/lib/cycle'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Clockwise: plan (left) → execute (top) → evaluate (right) → decide (bottom) → plan.
const LAYOUT: Record<StageKey, { angle: number; icon: string; label: string }> = {
  plan: { angle: 180, icon: '🗺️', label: 'Plan' },
  execute: { angle: 270, icon: '🧑‍💻', label: 'Execute' },
  evaluate: { angle: 0, icon: '📏', label: 'Evaluate' },
  decide: { angle: 90, icon: '👔', label: 'Decide' },
}
const ORDER: StageKey[] = ['plan', 'execute', 'evaluate', 'decide']

const SIZE = 240
const C = SIZE / 2
const R = 78
const NODE_R = 24

function point(angleDeg: number, r = R) {
  const a = (angleDeg * Math.PI) / 180
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}

/** Arc from one node's edge to the next node's edge, clockwise. */
function arcPath(from: number, to: number) {
  const pad = (NODE_R / R) * (180 / Math.PI) + 4 // degrees to clear the node circles
  const start = point(from + pad)
  const end = point((to < from ? to + 360 : to) - pad)
  return `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`
}

const NODE_STYLE: Record<StageStatus, string> = {
  active: 'fill-primary/15 stroke-primary',
  done: 'fill-green-500/10 stroke-green-500',
  idle: 'fill-background stroke-border',
  skipped: 'fill-background stroke-muted-foreground/30',
}

/**
 * The work loop as a ring: plan → execute → evaluate → decide. The stage
 * happening now glows; done stages turn green, skipped ones fade. The
 * centre shows the lap (1/1 for a mission, n/N for an auto-loop run) and
 * the score change; a sparkline or progress bar sits underneath.
 */
export function CycleRing({
  cycle,
  selected,
  onSelect,
  className,
}: {
  cycle: CycleModel
  selected: StageKey | null
  onSelect: (stage: StageKey) => void
  className?: string
}) {
  const team = cycle.team.slice(0, 4)
  const extra = cycle.team.length - team.length
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full max-h-[240px] w-auto select-none">
        <defs>
          <marker
            id="cycle-arrow"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground/50" />
          </marker>
        </defs>

        {/* Arcs between stages; the one leading into the current stage is lit. */}
        {ORDER.map((k, i) => {
          const next = ORDER[(i + 1) % ORDER.length]
          const lit = cycle.current === next
          const travelled =
            cycle.stages[next].status === 'done' || cycle.stages[next].status === 'active'
          return (
            <path
              key={k}
              d={arcPath(LAYOUT[k].angle, LAYOUT[next].angle)}
              fill="none"
              strokeWidth={lit ? 3 : 2}
              markerEnd="url(#cycle-arrow)"
              className={cn(
                lit ? 'stroke-primary' : travelled ? 'stroke-green-500/60' : 'stroke-border',
                lit && 'animate-pulse',
              )}
            />
          )
        })}

        {/* Centre: lap and score change */}
        <text
          x={C}
          y={C - 4}
          textAnchor="middle"
          className="fill-foreground text-[22px] font-semibold tabular-nums"
        >
          {cycle.laps ? `${cycle.lap}/${cycle.laps}` : `${cycle.lap}`}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {cycle.delta !== null
            ? `${cycle.delta >= 0 ? '▲' : '▼'}${Math.abs(cycle.delta * 100).toFixed(1)}%`
            : cycle.current
              ? t(LAYOUT[cycle.current].label)
              : t('Done')}
        </text>

        {/* Stage nodes */}
        {ORDER.map((k) => {
          const { angle, icon, label } = LAYOUT[k]
          const p = point(angle)
          const stage = cycle.stages[k]
          const active = stage.status === 'active'
          const isSelected = selected === k
          const labelY = angle === 90 ? p.y + NODE_R + 13 : p.y - NODE_R - 6
          return (
            <g
              key={k}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(k)
                }
              }}
              className="cursor-pointer outline-none"
              opacity={stage.status === 'skipped' ? 0.45 : 1}
            >
              {active && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 6}
                  className="fill-primary/10 animate-ping"
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={NODE_R}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={stage.status === 'skipped' || stage.estimated ? '4 3' : undefined}
                className={cn(NODE_STYLE[stage.status], isSelected && 'stroke-foreground')}
              />
              <text x={p.x} y={p.y + 6} textAnchor="middle" className="text-[18px]">
                {icon}
              </text>
              <text
                x={p.x}
                y={labelY}
                textAnchor="middle"
                className="fill-foreground text-[10px] font-medium"
              >
                {t(label)}
                {stage.items.length > 0 ? ` · ${stage.items.length}` : ''}
              </text>
              {k === 'execute' && team.length > 0 && (
                <text x={p.x} y={p.y + NODE_R + 14} textAnchor="middle" className="text-[11px]">
                  {team.map((r) => r.icon).join('')}
                  {extra > 0 ? ` +${extra}` : ''}
                </text>
              )}
              {stage.estimated && stage.status !== 'skipped' && (
                <text
                  x={p.x + NODE_R + 2}
                  y={p.y + NODE_R}
                  className="fill-muted-foreground text-[8px]"
                >
                  {t('est.')}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Under the ring: score trend for loops, plan progress for missions */}
      {cycle.scores.length > 1 ? (
        <Sparkline scores={cycle.scores} />
      ) : cycle.progress !== null ? (
        <div className="mt-1 w-40">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.round(cycle.progress * 100)}%` }}
            />
          </div>
          <div className="mt-0.5 text-center text-[10px] text-muted-foreground tabular-nums">
            {t('Plan {pct}%', { pct: Math.round(cycle.progress * 100) })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Scores per lap: accepted ●, rejected ○, bug ×, with a line through accepted ones. */
export function Sparkline({
  scores,
  width = 180,
  height = 40,
}: {
  scores: CycleModel['scores']
  width?: number
  height?: number
}) {
  const values = scores.map((s) => s.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => 4 + (i / Math.max(1, scores.length - 1)) * (width - 8)
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8)
  // Line of the best-so-far accepted score.
  let best = -Infinity
  const bestLine = scores
    .map((s, i) => {
      if (s.kind === 'accepted') best = Math.max(best, s.value)
      return Number.isFinite(best) ? `${x(i)},${y(best)}` : null
    })
    .filter(Boolean)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-10 w-[180px]">
      {bestLine && (
        <polyline points={bestLine} fill="none" strokeWidth={1.5} className="stroke-green-500" />
      )}
      {scores.map((s, i) =>
        s.kind === 'bug' ? (
          <text
            key={i}
            x={x(i)}
            y={y(s.value) + 3}
            textAnchor="middle"
            className="fill-red-500 text-[9px]"
          >
            ×
          </text>
        ) : (
          <circle
            key={i}
            cx={x(i)}
            cy={y(s.value)}
            r={2.5}
            strokeWidth={1.2}
            className={
              s.kind === 'accepted'
                ? 'fill-green-500 stroke-green-500'
                : 'fill-background stroke-muted-foreground'
            }
          />
        ),
      )}
    </svg>
  )
}
