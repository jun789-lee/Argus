import { describe, expect, test } from 'vitest'
import { estimateProgress, samplesFor, stallThresholdMs } from './eta'

const min = 60_000

describe('estimateProgress', () => {
  test('needs at least 3 samples', () => {
    expect(estimateProgress(min, [5 * min, 6 * min])).toBeNull()
  })

  test('early on, progress is elapsed / median of runs longer than elapsed', () => {
    const e = estimateProgress(1 * min, [2 * min, 4 * min, 6 * min, 8 * min])!
    // runs longer than 1m: 2,4,6,8 → median 5m
    expect(e.progress).toBeCloseTo(0.2)
    expect(e.remainingMs).toBe(4 * min)
    expect(e.typicalMs).toBe(5 * min)
    expect(e.overdue).toBe(false)
  })

  test('conditioning keeps long tasks from sticking near 100%', () => {
    // At 5m, only the 6m and 20m runs are still relevant → expect ~13m total.
    const e = estimateProgress(5 * min, [2 * min, 3 * min, 4 * min, 6 * min, 20 * min])!
    expect(e.remainingMs).toBe(8 * min)
    expect(e.progress).toBeCloseTo(5 / 13)
  })

  test('past every known run → overdue, capped below 100%', () => {
    const e = estimateProgress(30 * min, [2 * min, 3 * min, 4 * min])!
    expect(e).toMatchObject({ overdue: true, progress: 0.95, remainingMs: 0, typicalMs: 3 * min })
  })
})

describe('samplesFor', () => {
  const stats = {
    byType: { Explore: { durationsMs: [1, 2, 3] }, Plan: { durationsMs: [9] } },
    all: { durationsMs: [1, 2, 3, 9] },
  }
  test('prefers the agent type, falls back to all subagents', () => {
    expect(samplesFor(stats, 'Explore')).toEqual({ durations: [1, 2, 3], scope: 'type' })
    expect(samplesFor(stats, 'Plan')?.scope).toBe('all')
    expect(samplesFor(stats, null)?.scope).toBe('all')
    expect(samplesFor(null, 'Explore')).toBeNull()
  })
})

test('stall threshold is at least 3 minutes', () => {
  expect(stallThresholdMs(null)).toBe(3 * min)
  expect(stallThresholdMs(20 * min)).toBe(10 * min)
})
