import { describe, expect, it } from 'vitest'
import { applyIteration, isAnomaly, judge, stopReason, type LoopState } from '../src/decide'
import { expandSpec } from '../src/spec'
import type { Scored, Spec } from '../src/types'

const spec = expandSpec({
  version: 1,
  class: 'ml-improve',
  preset: 'optimization',
  name: 't',
  goal: { objective: 'o' },
  workspace: { repo: '/r', editable: ['src/**'] },
  worker: { instructions: 'i' },
  checks: { score: { run: 's', metric: 'cost', direction: 'minimize' } },
  budget: { max_iterations: 10, wall_clock: '1h', usd: 5 },
}).spec as Spec

const s = (value: number, cases: number[] | null = null, se: number | null = null): Scored => ({
  iteration: 0,
  commit: `c${value}`,
  value,
  se,
  cases: cases ? cases.map((v, i) => ({ id: `case-${i}`, value: v })) : null,
})

describe('judge', () => {
  it('accepts a lower cost that clears the relative margin', () => {
    const j = judge(s(990), s(1000), spec.acceptance)
    expect(j.accept).toBe(true)
    expect(j.delta).toBe(10)
    expect(j.threshold).toBe(1) // 0.1% of 1000
  })

  it('rejects an improvement inside the margin, and anything worse', () => {
    expect(judge(s(999.5), s(1000), spec.acceptance).accept).toBe(false)
    expect(judge(s(1010), s(1000), spec.acceptance).accept).toBe(false)
  })

  it('flips the sign for maximize', () => {
    const acc = { ...spec.acceptance, direction: 'maximize' as const }
    expect(judge(s(1010), s(1000), acc).accept).toBe(true)
    expect(judge(s(990), s(1000), acc).accept).toBe(false)
  })

  it('pairs cases and demands the improvement beat the noise', () => {
    const acc = { ...spec.acceptance, direction: 'maximize' as const, paired: true, seMultiplier: 2, relative: 0 }
    // Same seeds, consistently +1: tiny SE, accepted.
    const steady = judge(s(11, [11, 12, 13, 14]), s(10, [10, 11, 12, 13]), acc)
    expect(steady.delta).toBeCloseTo(1)
    expect(steady.deltaSe).toBeCloseTo(0)
    expect(steady.accept).toBe(true)
    // Same mean gain, but one lucky seed carries it: noise bar not cleared.
    const lucky = judge(s(11, [10, 11, 12, 17]), s(10, [10, 11, 12, 13]), acc)
    expect(lucky.delta).toBeCloseTo(1)
    expect(lucky.accept).toBe(false)
  })

  it('flags improvements far beyond the noise as anomalies', () => {
    const acc = { ...spec.acceptance, direction: 'maximize' as const, seMultiplier: 2, relative: 0 }
    const j = judge(s(20, null, 0.5), s(10, null, 0.5), acc)
    expect(isAnomaly(j, { seMultiplier: 8 })).toBe(true)
    expect(isAnomaly(j, null)).toBe(false)
  })
})

describe('iteration bookkeeping', () => {
  const start = (): LoopState => ({
    startedAt: 0,
    iterationsDone: 0,
    best: s(1000),
    head: 'c1000',
    improveMisses: 0,
    debug: null,
    integrityViolations: 0,
    costUsd: 0,
  })

  it('moves best and head on acceptance', () => {
    const st = applyIteration(start(), spec, { operator: 'improve', verdict: 'accepted', commit: 'c900', candidate: s(900), costUsd: 1 })
    expect(st.best.value).toBe(900)
    expect(st.head).toBe('c900')
    expect(st.costUsd).toBe(1)
  })

  it('debugs a broken candidate up to the chain limit, then reverts to best', () => {
    let st = applyIteration(start(), spec, { operator: 'improve', verdict: 'bug', commit: 'b1', candidate: null, costUsd: 0, error: 'boom' })
    expect(st.debug).toEqual({ candidate: 'b1', attempts: 1, error: 'boom' })
    expect(st.head).toBe('b1')
    for (const c of ['b2', 'b3']) {
      st = applyIteration(st, spec, { operator: 'debug', verdict: 'bug', commit: c, candidate: null, costUsd: 0 })
      expect(st.debug?.candidate).toBe(c)
    }
    st = applyIteration(st, spec, { operator: 'debug', verdict: 'bug', commit: 'b4', candidate: null, costUsd: 0 })
    expect(st.debug).toBeNull() // 3 failed debug attempts: give up
    expect(st.head).toBe('c1000')
  })

  it('counts improve misses toward the plateau but not debug ones', () => {
    let st = start()
    st = applyIteration(st, spec, { operator: 'improve', verdict: 'rejected', commit: 'r1', candidate: null, costUsd: 0 })
    st = applyIteration(st, spec, { operator: 'improve', verdict: 'no_change', commit: null, candidate: null, costUsd: 0 })
    expect(st.improveMisses).toBe(2)
    expect(stopReason(st, spec, 0)).toBeNull()
    st = applyIteration(st, spec, { operator: 'improve', verdict: 'bug', commit: 'b', candidate: null, costUsd: 0 })
    expect(st.improveMisses).toBe(3)
    expect(stopReason(st, spec, 0)).toBe('plateau')
  })
})

describe('stopReason', () => {
  const st = (over: Partial<LoopState>): LoopState => ({
    startedAt: 0, iterationsDone: 0, best: s(1), head: 'h', improveMisses: 0, debug: null, integrityViolations: 0, costUsd: 0, ...over,
  })
  it('stops on the iteration cap, wall clock, spend and repeat integrity violations', () => {
    expect(stopReason(st({ iterationsDone: 10 }), spec, 0)).toBe('max_iterations')
    expect(stopReason(st({}), spec, 3_600_000)).toBe('budget_time')
    expect(stopReason(st({ costUsd: 5 }), spec, 0)).toBe('budget_usd')
    expect(stopReason(st({ integrityViolations: 2 }), spec, 0)).toBe('integrity_violation')
    expect(stopReason(st({ iterationsDone: 3 }), spec, 1000)).toBeNull()
  })
})
