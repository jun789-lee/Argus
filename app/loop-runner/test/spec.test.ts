import { describe, expect, it } from 'vitest'
import { checkEnv } from '../src/checks'
import { expandSpec, parseDuration } from '../src/spec'

const base = {
  version: 1,
  class: 'ml-improve',
  preset: 'optimization',
  name: 'qc-test',
  goal: { objective: 'minimize cost' },
  workspace: { repo: 'C:\\repo', editable: ['circuits/**'], protected: ['tools/**'] },
  worker: { instructions: 'do it' },
  checks: {
    quick: { run: 'q {worktree}' },
    score: { run: 's {worktree}', metric: 'cost', direction: 'minimize', timeout: '45m' },
    sealed: { run: 'x {worktree}' },
  },
  known_bad: 'C:/bad',
  budget: { max_iterations: 5, wall_clock: '4h' },
}

describe('parseDuration', () => {
  it('reads s/m/h/d', () => {
    const e: string[] = []
    expect(parseDuration('45s', 'f', e)).toBe(45_000)
    expect(parseDuration('30m', 'f', e)).toBe(1_800_000)
    expect(parseDuration('4h', 'f', e)).toBe(14_400_000)
    expect(e).toEqual([])
  })

  it('rejects other shapes', () => {
    const e: string[] = []
    expect(parseDuration('soon', 'budget.wall_clock', e)).toBeNull()
    expect(e[0]).toMatch(/budget\.wall_clock/)
  })
})

describe('expandSpec (ml-improve class)', () => {
  it('fills the three check slots from the class and preset', () => {
    const { spec, errors } = expandSpec(base)
    expect(errors).toEqual([])
    expect(spec!.verifiers.map((v) => [v.id, v.role, v.access, v.when])).toEqual([
      ['quick', 'gate', 'dev', 'every'],
      ['score', 'score', 'dev', 'every'],
      ['sealed', 'gate', 'sealed', 'on_accept'], // optimization: sealed is a second gate
    ])
    expect(spec!.verifiers[1].timeoutMs).toBe(45 * 60_000)
    expect(spec!.acceptance).toMatchObject({ metric: 'cost', direction: 'minimize', relative: 0.001, paired: false, seMultiplier: null })
    expect(spec!.workspace.repo).toBe('C:/repo')
  })

  it('applies class defaults the spec leaves out', () => {
    const { spec } = expandSpec(base)
    expect(spec!.worker.permissionMode).toBe('bypassPermissions')
    expect(spec!.worker.disallowedTools).toContain('Bash(git push*)')
    expect(spec!.worker.timeoutMs).toBe(30 * 60_000)
    expect(spec!.stop.debugChain.max).toBe(3)
    expect(spec!.stop.plateau).toEqual({ window: 3 })
    expect(spec!.humanGates.start).toBe('required')
  })

  it('turns the plan nudge off for workers through --settings env, and merges worker.env', () => {
    expect(expandSpec(base).spec!.worker.settingsEnv).toEqual({ AGENTS_OBSERVE_PLAN_NUDGE: '0' })
    const { spec } = expandSpec({ ...base, worker: { ...base.worker, env: { FOO: 'bar', AGENTS_OBSERVE_PLAN_NUDGE: '1' } } })
    expect(spec!.worker.settingsEnv).toEqual({ AGENTS_OBSERVE_PLAN_NUDGE: '1', FOO: 'bar' })
  })

  it('uses noisy-score defaults for the data preset', () => {
    const { spec } = expandSpec({ ...base, preset: 'data' })
    expect(spec!.acceptance).toMatchObject({ paired: true, seMultiplier: 2 })
    expect(spec!.verifiers.find((v) => v.id === 'sealed')!.role).toBe('watch')
    expect(spec!.stop.divergence).toEqual({ window: 2 })
  })

  it('lets overrides replace preset values', () => {
    const { spec } = expandSpec({ ...base, overrides: { relative: 0.02, plateau_window: 6 } })
    expect(spec!.acceptance.relative).toBe(0.02)
    expect(spec!.stop.plateau).toEqual({ window: 6 })
  })

  it('requires a score check and an iteration cap', () => {
    const { spec, errors } = expandSpec({ ...base, checks: { quick: base.checks.quick }, budget: {} })
    expect(spec).toBeNull()
    expect(errors.join('\n')).toMatch(/checks\.score: required/)
    expect(errors.join('\n')).toMatch(/max_iterations: required/)
  })

  it('rejects editable paths that overlap protected ones', () => {
    const { errors } = expandSpec({ ...base, workspace: { ...base.workspace, protected: ['circuits/invsqrt/**'] } })
    expect(errors.join('\n')).toMatch(/overlaps/)
  })

  it('warns when the sealed check or known-bad candidate is missing', () => {
    const { warnings } = expandSpec({ ...base, checks: { quick: base.checks.quick, score: base.checks.score }, known_bad: undefined })
    expect(warnings.join('\n')).toMatch(/checks\.sealed: missing/)
    expect(warnings.join('\n')).toMatch(/known_bad: missing/)
  })

  it('only knows the ml-improve class', () => {
    expect(expandSpec({ ...base, class: 'other' }).errors.join('\n')).toMatch(/class: must be "ml-improve"/)
  })
})

describe('checkEnv', () => {
  it.runIf(process.platform === 'win32')('puts System32 on PATH when a shell left it out', () => {
    const env = checkEnv({ Path: 'C:\\tools;C:\\Git\\bin', SystemRoot: 'C:\\Windows' })
    expect(env.Path!.split(';')[0]).toBe('C:\\Windows\\System32')
    // Already present (any case, trailing slash): left alone.
    const kept = checkEnv({ Path: 'c:\\windows\\system32\\;C:\\tools', SystemRoot: 'C:\\Windows' })
    expect(kept.Path).toBe('c:\\windows\\system32\\;C:\\tools')
  })
})
