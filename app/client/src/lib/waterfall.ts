// Lays out the turn tree as a waterfall: one horizontal bar per prompt /
// subagent on a shared time axis, children indented under their parent,
// with a tick per tool call inside each bar. Pure geometry (percentages of
// the visible window) so rendering stays a thin component.

import type { TurnNode, TurnStatus } from './turn-tree'

export interface WaterfallTick {
  /** Position within the visible window, 0–100. */
  pct: number
  failed: boolean
}

export interface WaterfallRow {
  node: TurnNode
  depth: number
  /** Bar geometry within the visible window, 0–100. */
  leftPct: number
  widthPct: number
  /** Bar continues past the window's left / right edge. */
  clippedStart: boolean
  clippedEnd: boolean
  status: TurnStatus
  ticks: WaterfallTick[]
  /** Subagents folded into this row (compact mode). */
  hiddenChildren: number
}

export interface WaterfallLayout {
  rows: WaterfallRow[]
  from: number
  to: number
}

const TOOL_START = new Set(['PreToolUse'])

function countDescendants(node: TurnNode): number {
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0)
}

/**
 * @param from/to visible window (ms). Pass `fitSession()` for the whole session.
 * @param compact prompts only — subagents are folded into their prompt row.
 */
export function layoutWaterfall(
  roots: TurnNode[],
  opts: { from: number; to: number; now: number; compact?: boolean },
): WaterfallLayout {
  const { from, now, compact = false } = opts
  const to = Math.max(opts.to, from + 1)
  const span = to - from
  const pct = (ts: number) => ((ts - from) / span) * 100
  const rows: WaterfallRow[] = []

  const visit = (node: TurnNode, depth: number) => {
    if (node.kind === 'system') return
    const end = node.endedAt ?? now
    // Skip bars entirely outside the window, but keep walking children:
    // a long-running subagent can outlive its prompt's visible range.
    if (end >= from && node.startedAt <= to) {
      const left = Math.max(0, pct(node.startedAt))
      const right = Math.min(100, pct(end))
      const ticks: WaterfallTick[] = []
      const failedIds = new Set(
        node.events
          .filter((e) => e.hookName === 'PostToolUseFailure')
          .map((e) => e.payload?.tool_use_id),
      )
      for (const e of node.events) {
        if (!TOOL_START.has(e.hookName) || e.timestamp < from || e.timestamp > to) continue
        ticks.push({ pct: pct(e.timestamp), failed: failedIds.has(e.payload?.tool_use_id) })
      }
      rows.push({
        node,
        depth,
        leftPct: left,
        // Keep instant turns visible as a sliver.
        widthPct: Math.max(right - left, 0.4),
        clippedStart: node.startedAt < from,
        clippedEnd: end > to,
        status: node.status,
        ticks,
        hiddenChildren: compact ? countDescendants(node) : 0,
      })
    }
    if (!compact) node.children.forEach((c) => visit(c, depth + 1))
  }
  roots.forEach((r) => visit(r, 0))
  return { rows, from, to }
}

/** Window covering the whole session, with a little padding on the right. */
export function fitSession(roots: TurnNode[], now: number): { from: number; to: number } {
  let from = Infinity
  let to = -Infinity
  const walk = (n: TurnNode) => {
    if (n.kind !== 'system') {
      from = Math.min(from, n.startedAt)
      to = Math.max(to, n.endedAt ?? now)
    }
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  if (!Number.isFinite(from)) return { from: now - 60_000, to: now }
  const pad = Math.max((to - from) * 0.02, 1000)
  return { from, to: to + pad }
}
