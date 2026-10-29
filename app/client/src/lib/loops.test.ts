import { describe, expect, test } from 'vitest'
import { cycleFromRun, improvement, scoreKind, stageOfState, type LoopRunDetail } from './loops'

const run = (over: Partial<LoopRunDetail['run']> = {}): LoopRunDetail['run'] => ({
  id: 'r1',
  loopName: 'speed-up',
  state: 'working',
  terminalReason: null,
  bestIteration: 2,
  baselineScore: 100,
  bestScore: 80,
  direction: 'minimize',
  iterationsDone: 3,
  iterationsMax: 20,
  costUsd: 1.2,
  startedAt: 0,
  endedAt: null,
  ...over,
})

const it = (n: number, verdict: string | null, score: number | null, sessionId = `s${n}`) => ({
  runId: 'r1',
  n,
  sessionId,
  verdict,
  score,
  hypothesis: `try ${n}`,
})

describe('loops', () => {
  test('runner phases map onto ring stages', () => {
    expect(stageOfState('calibrating')).toBe('plan')
    expect(stageOfState('working')).toBe('execute')
    expect(stageOfState('checking')).toBe('evaluate')
    expect(stageOfState('alert')).toBe('decide')
    expect(stageOfState('finished')).toBeNull()
    expect(stageOfState('something-new')).toBeNull()
  })

  test('verdicts become lap score kinds', () => {
    expect(scoreKind('accepted')).toBe('accepted')
    expect(scoreKind('rejected')).toBe('rejected')
    expect(scoreKind('no_change')).toBe('rejected')
    expect(scoreKind('timeout')).toBe('bug')
  })

  test('improvement is signed so that up is better', () => {
    expect(improvement(run())).toBeCloseTo(0.2) // minimize: 100 → 80 is +20%
    expect(improvement(run({ direction: 'maximize', bestScore: 120 }))).toBeCloseTo(0.2)
    expect(improvement(run({ baselineScore: null }))).toBeNull()
  })

  test('a run mid-iteration: laps, scores, current stage and the live worker', () => {
    const c = cycleFromRun({
      run: run(),
      iterations: [
        it(1, 'accepted', 90),
        it(2, 'accepted', 80),
        it(3, 'bug', 140),
        it(4, null, null),
      ],
      gates: [],
    })
    expect(c.current).toBe('execute')
    expect(c).toMatchObject({ lap: 4, laps: 20 })
    expect(c.scores).toEqual([
      { value: 90, kind: 'accepted' },
      { value: 80, kind: 'accepted' },
      { value: 140, kind: 'bug' },
    ])
    expect(c.stages.execute).toMatchObject({ status: 'active' })
    expect(c.stages.execute.items[0]).toMatchObject({
      nodeId: 's4',
      state: 'running',
      label: 'try 4',
    })
    expect(c.stages.decide.items.map((i) => i.label)).toEqual([
      '#1 accepted',
      '#2 accepted',
      '#3 bug',
    ])
  })

  test('pending gates surface as items; a finished run has no current stage', () => {
    const waiting = cycleFromRun({
      run: run({ state: 'awaiting_start', iterationsDone: 0 }),
      iterations: [],
      gates: [{ id: 'g1', runId: 'r1', kind: 'start', state: 'pending', createdAt: 0 }],
    })
    expect(waiting.current).toBe('plan')
    expect(waiting.stages.plan.items.map((i) => i.icon)).toEqual(['📐', '✋'])

    const done = cycleFromRun({
      run: run({ state: 'finished', endedAt: 10 }),
      iterations: [it(1, 'accepted', 90)],
      gates: [],
    })
    expect(done.current).toBeNull()
    expect(done.stages.execute.status).toBe('done')
  })
})
