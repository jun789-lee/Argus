import { describe, expect, test } from 'vitest'
import { fitSession, layoutWaterfall } from './waterfall'
import type { TurnNode } from './turn-tree'

function node(p: Partial<TurnNode> & Pick<TurnNode, 'id' | 'startedAt'>): TurnNode {
  return {
    kind: 'prompt',
    agentId: 's',
    title: p.id,
    prompt: null,
    agentType: null,
    events: [],
    children: [],
    endedAt: null,
    lastEventAt: p.startedAt,
    status: 'done',
    toolCount: 0,
    errorCount: 0,
    ...p,
  }
}

describe('layoutWaterfall', () => {
  const sub = node({ id: 'a', kind: 'subagent', startedAt: 20, endedAt: 60 })
  const p1 = node({
    id: 'p1',
    startedAt: 0,
    endedAt: 100,
    children: [sub],
    events: [
      {
        id: 1,
        agentId: 's',
        hookName: 'PreToolUse',
        timestamp: 50,
        payload: { tool_use_id: 't1' },
      },
      {
        id: 2,
        agentId: 's',
        hookName: 'PostToolUseFailure',
        timestamp: 55,
        payload: { tool_use_id: 't1' },
      },
    ],
  })
  const sys = node({ id: 'sys', kind: 'system', startedAt: 0, endedAt: 0 })

  test('one row per prompt/subagent with depth, positions and ticks', () => {
    const { rows } = layoutWaterfall([sys, p1], { from: 0, to: 200, now: 200 })
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['p1', 0],
      ['a', 1],
    ])
    expect(rows[0]).toMatchObject({ leftPct: 0, widthPct: 50, clippedEnd: false })
    expect(rows[0].ticks).toEqual([{ pct: 25, failed: true }])
    expect(rows[1]).toMatchObject({ leftPct: 10, widthPct: 20 })
  })

  test('running bars extend to now and clip at the window edges', () => {
    const running = node({ id: 'r', startedAt: 50, status: 'running' })
    const { rows } = layoutWaterfall([running], { from: 100, to: 200, now: 300 })
    expect(rows[0]).toMatchObject({
      leftPct: 0,
      widthPct: 100,
      clippedStart: true,
      clippedEnd: true,
    })
  })

  test('compact folds subagents into their prompt', () => {
    const { rows } = layoutWaterfall([p1], { from: 0, to: 200, now: 200, compact: true })
    expect(rows).toHaveLength(1)
    expect(rows[0].hiddenChildren).toBe(1)
  })

  test('drops bars outside the window but keeps their in-window children', () => {
    const late = node({ id: 'late', kind: 'subagent', startedAt: 150, endedAt: 180 })
    const early = node({ id: 'early', startedAt: 0, endedAt: 10, children: [late] })
    const { rows } = layoutWaterfall([early], { from: 100, to: 200, now: 200 })
    expect(rows.map((r) => r.node.id)).toEqual(['late'])
  })

  test('fitSession spans every non-system node', () => {
    const w = fitSession([sys, p1], 500)
    expect(w.from).toBe(0)
    expect(w.to).toBeGreaterThan(100)
  })
})
