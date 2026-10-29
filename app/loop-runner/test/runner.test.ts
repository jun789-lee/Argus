// End-to-end runs against a throwaway repo, with a scripted fake worker and fake graders, so
// every path (accept, reject, debug, scope, integrity, timeouts, resume) runs without tokens.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as journal from '../src/journal'
import { runLoop } from '../src/runner'
import { FAKE_WORKER, sandbox } from './helpers'

const quiet = () => {}
const run = (loopHome: string, extra: Partial<Parameters<typeof runLoop>[0]> = {}) =>
  runLoop({ loopHome, yes: true, fakeWorker: FAKE_WORKER, log: quiet, ...extra })

function verdicts(runDir: string) {
  return journal.iterations(journal.read(join(runDir, 'journal.jsonl'))).map((i) => i.verdict)
}

describe('runLoop', { timeout: 120_000 }, () => {
  it('keeps improvements, rejects regressions, and returns the best on its branch', async () => {
    const sb = sandbox({ maxIterations: 4 })
    sb.scenario([{ set: 90 }, { set: 95 }, { set: 80 }, { set: 79.99 }])
    const sum = await run(sb.loopHome)

    expect(sum.reason).toBe('max_iterations')
    expect(sum.baseline.value).toBe(100)
    expect(sum.best.value).toBe(80)
    expect(verdicts(sum.runDir)).toEqual(['accepted', 'rejected', 'accepted', 'rejected']) // 79.99 is inside the 0.1% margin
    // The worktree is left at the best version, which is the tip of the run's branch history.
    expect(readFileSync(join(sum.worktree, 'src', 'value.txt'), 'utf8').trim()).toBe('80')
    const branchHead = execFileSync('git', ['rev-parse', sum.branch], { cwd: sb.repo }).toString().trim()
    expect(branchHead).toBe(sum.best.commit)
  })

  it('tells the next worker what happened, but never the sealed check details', async () => {
    const sb = sandbox({ maxIterations: 2 })
    sb.scenario([{ set: 50, touch: 'src/sealed_fail' }, { set: 60 }])
    const sum = await run(sb.loopHome)
    const its = journal.iterations(journal.read(join(sum.runDir, 'journal.jsonl')))
    expect(its[0].verdict).toBe('rejected')
    expect(its[0].feedback).toBe('Not accepted: the candidate failed an additional check.')
    const prompt2 = readFileSync(join(sum.runDir, 'logs', 'iter-2-prompt.md'), 'utf8')
    expect(prompt2).toContain('failed an additional check')
    expect(prompt2).not.toContain('must not leak')
    expect(JSON.stringify(its[0].checks)).not.toContain('must not leak')
    expect(sum.best.value).toBe(60)
  })

  it('debugs a broken candidate and accepts the fix', async () => {
    const sb = sandbox({ maxIterations: 2 })
    sb.scenario([{ set: 'oops' }, { set: 70 }])
    const sum = await run(sb.loopHome)
    const its = journal.iterations(journal.read(join(sum.runDir, 'journal.jsonl')))
    expect(its.map((i) => [i.operator, i.verdict])).toEqual([['improve', 'bug'], ['debug', 'accepted']])
    expect(readFileSync(join(sum.runDir, 'logs', 'iter-2-prompt.md'), 'utf8')).toContain('could not parse "oops"')
    expect(sum.best.value).toBe(70)
  })

  it('gives up on a candidate after three failed debug attempts and goes back to best', async () => {
    const sb = sandbox({ maxIterations: 5, plateau: 9 })
    sb.scenario([{ set: 'x1' }, { set: 'x2' }, { set: 'x3' }, { set: 'x4' }, { set: 85 }])
    const sum = await run(sb.loopHome)
    const its = journal.iterations(journal.read(join(sum.runDir, 'journal.jsonl')))
    expect(its.map((i) => i.operator)).toEqual(['improve', 'debug', 'debug', 'debug', 'improve'])
    expect(its[4].startCommit).toBe(sum.baseline.commit) // back to best before the fresh attempt
    expect(sum.best.value).toBe(85)
  })

  it('rejects changes outside the editable paths without stopping', async () => {
    const sb = sandbox({ maxIterations: 2 })
    sb.scenario([{ set: 10, touch: 'README.md' }, { set: 90 }])
    const sum = await run(sb.loopHome)
    expect(verdicts(sum.runDir)).toEqual(['out_of_scope', 'accepted'])
    expect(sum.best.value).toBe(90)
  })

  it('stops on a change to a protected path', async () => {
    const sb = sandbox({ maxIterations: 3 })
    sb.scenario([{ set: 10, touch: 'tests/fixed.txt' }, { set: 5 }])
    const sum = await run(sb.loopHome)
    expect(sum.reason).toBe('integrity_violation')
    expect(verdicts(sum.runDir)).toEqual(['integrity_violation'])
    expect(sum.best.value).toBe(100)
  })

  it('stops at once when the graders change during an iteration', async () => {
    const sb = sandbox({ maxIterations: 3 })
    sb.scenario([{ set: 10, tamper: `${sb.loopHome}/verifiers/check.txt` }])
    const sum = await run(sb.loopHome)
    expect(sum.reason).toBe('integrity_violation')
    expect(sum.best.value).toBe(100)
  })

  it('stops on a plateau of unaccepted improve attempts', async () => {
    const sb = sandbox({ maxIterations: 9 })
    sb.scenario([{ set: 120 }, { noop: true }, { set: 100 }, { set: 50 }])
    const sum = await run(sb.loopHome)
    expect(sum.reason).toBe('plateau') // optimization preset: 3 misses in a row
    expect(verdicts(sum.runDir)).toEqual(['rejected', 'no_change', 'rejected'])
  })

  it('ends the iteration when the worker runs out of time', async () => {
    const sb = sandbox({ maxIterations: 1, workerTimeout: '2s' })
    sb.scenario([{ sleep: 10_000, set: 1 }])
    const sum = await run(sb.loopHome)
    expect(verdicts(sum.runDir)).toEqual(['timeout'])
    expect(sum.best.value).toBe(100)
  })

  it('escalates when the worker asks for a human', async () => {
    const sb = sandbox({ maxIterations: 3 })
    sb.scenario([{ needsHuman: true, set: 1 }])
    const sum = await run(sb.loopHome)
    expect(sum.reason).toBe('escalated')
    expect(sum.best.value).toBe(100)
  })

  it('refuses to start when the graders pass the known-bad candidate', async () => {
    const sb = sandbox({ maxIterations: 1 })
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(`${sb.loopHome}/verifiers/known_bad/src/value.txt`)}, '100')`])
    sb.scenario([{ set: 1 }])
    await expect(run(sb.loopHome)).rejects.toThrow(/did not reject the known-bad candidate/)
  })

  it('waits after calibration for start approval, then starts without recalibrating', async () => {
    const sb = sandbox({ maxIterations: 1 })
    sb.scenario([{ set: 50 }])
    // No terminal and no --yes: the run stops at the start gate (vitest's stdin is not a TTY).
    const waiting = await runLoop({ loopHome: sb.loopHome, fakeWorker: FAKE_WORKER, log: quiet })
    expect(waiting.reason).toBe('awaiting_start')
    const evs = () => journal.read(join(waiting.runDir, 'journal.jsonl'))
    expect(evs().some((e) => e.type === 'gate')).toBe(false)

    const sum = await runLoop({ loopHome: sb.loopHome, fakeWorker: FAKE_WORKER, log: quiet, approve: true, resumeRunId: waiting.runId })
    expect(sum.reason).toBe('max_iterations')
    expect(sum.best.value).toBe(50)
    expect(evs().filter((e) => e.type === 'calibration')).toHaveLength(1)
    expect(evs().find((e) => e.type === 'gate')).toMatchObject({ kind: 'start', decision: 'continue', by: 'terminal' })
  })

  it('resumes a run whose grader broke mid-way by re-scoring the committed candidate', async () => {
    const sb = sandbox({ maxIterations: 3 })
    sb.scenario([{ set: 90 }, { set: 80 }, { set: 70 }])
    process.env.FAKE_GRADER_BREAK_AT = '80' // the grader can't score iteration 2's candidate
    let runId = ''
    try {
      await expect(
        run(sb.loopHome, {
          log: (l) => {
            const m = /^run (\S+):/.exec(l)
            if (m) runId = m[1]
          },
        }),
      ).rejects.toThrow(/printed no verdict JSON/)
    } finally {
      delete process.env.FAKE_GRADER_BREAK_AT
    }
    const evs = () => journal.read(join(sb.loopHome, 'runs', runId, 'journal.jsonl'))
    expect(journal.pendingCandidate(evs(), 2)).toMatchObject({ n: 2, operator: 'improve' })

    // If the worker ran again it would write 10; the resumed run must score the saved 80 instead.
    sb.scenario([{ set: 90 }, { set: 10 }, { set: 70 }])
    const sum = await run(sb.loopHome, { resumeRunId: runId })
    expect(sum.runId).toBe(runId)
    const its = journal.iterations(evs())
    expect(its.map((i) => [i.n, i.verdict, i.scored?.value])).toEqual([
      [1, 'accepted', 90],
      [2, 'accepted', 80],
      [3, 'accepted', 70],
    ])
    expect(its[1].costUsd).toBe(0.01) // the interrupted attempt's cost is kept, not paid twice
  })
})
