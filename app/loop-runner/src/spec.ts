// Load a short, class-based loop spec and expand it into the full Spec the runner executes.

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { CLASS_NAME, classDefaults, presets } from './classes/ml-improve'
import type { Direction, Spec, Verifier } from './types'

export interface ExpandResult {
  spec: Spec | null
  errors: string[]
  warnings: string[]
}

/** `45s` / `30m` / `4h` / `2d` -> milliseconds. */
export function parseDuration(value: unknown, field: string, errors: string[]): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && value > 0) return value * 1000
  const m = typeof value === 'string' ? /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(value.trim()) : null
  if (!m) {
    errors.push(`${field}: expected a duration like "30m" or "4h", got ${JSON.stringify(value)}`)
    return null
  }
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2] as 's' | 'm' | 'h' | 'd']
  return Number(m[1]) * unit
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStrings(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value
  errors.push(`${field}: expected a list of strings`)
  return []
}

function stringMap(value: unknown, field: string, errors: string[]): Record<string, string> {
  if (value === undefined || value === null) return {}
  const r = asRecord(value)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    else errors.push(`${field}.${k}: expected a string`)
  }
  return out
}

function requireString(value: unknown, field: string, errors: string[]): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  errors.push(`${field}: required`)
  return ''
}

/** True when a glob from `a` could match a path that a glob from `b` matches (conservative). */
function globsOverlap(a: string, b: string): boolean {
  const prefix = (g: string) => g.split('*')[0]
  const pa = prefix(a)
  const pb = prefix(b)
  return pa.startsWith(pb) || pb.startsWith(pa)
}

export function expandSpec(raw: unknown): ExpandResult {
  const errors: string[] = []
  const warnings: string[] = []
  const r = asRecord(raw)

  if (r.version !== 1) errors.push('version: must be 1')
  if (r.class !== CLASS_NAME) {
    errors.push(`class: must be "${CLASS_NAME}" (the only class in v1)`)
  }
  const presetName = typeof r.preset === 'string' ? r.preset : ''
  const preset = presets[presetName]
  if (!preset) errors.push(`preset: must be one of ${Object.keys(presets).join(', ')}`)
  const overrides = asRecord(r.overrides)

  const name = requireString(r.name, 'name', errors)
  if (name && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    errors.push('name: use lowercase letters, digits and dashes')
  }

  const goal = asRecord(r.goal)
  const workspace = asRecord(r.workspace)
  const worker = asRecord(r.worker)
  const checks = asRecord(r.checks)
  const budget = asRecord(r.budget)

  const editable = asStrings(workspace.editable, 'workspace.editable', errors)
  const protectedPaths = asStrings(workspace.protected, 'workspace.protected', errors)
  if (editable.length === 0) errors.push('workspace.editable: list at least one path pattern')
  for (const e of editable) {
    for (const p of protectedPaths) {
      if (globsOverlap(e, p)) errors.push(`workspace: "${e}" (editable) overlaps "${p}" (protected)`)
    }
  }

  // Checks: the class's three slots.
  const verifiers: Verifier[] = []
  const defaultCheckTimeout = parseDuration(classDefaults.checkTimeout, 'class checkTimeout', errors)!
  const slot = (id: 'quick' | 'score' | 'sealed') => {
    const c = asRecord(checks[id])
    if (Object.keys(c).length === 0) return null
    const run = requireString(c.run, `checks.${id}.run`, errors)
    const timeoutMs = parseDuration(c.timeout, `checks.${id}.timeout`, errors) ?? defaultCheckTimeout
    return { c, run, timeoutMs }
  }
  const quick = slot('quick')
  const score = slot('score')
  const sealed = slot('sealed')
  if (quick) {
    verifiers.push({ id: 'quick', run: quick.run, timeoutMs: quick.timeoutMs, trust: 'high', access: 'dev', role: 'gate', when: 'every' })
  } else {
    warnings.push('checks.quick: missing — every candidate goes straight to the full score check')
  }
  let metric = ''
  let direction: Direction = 'maximize'
  if (score) {
    verifiers.push({ id: 'score', run: score.run, timeoutMs: score.timeoutMs, trust: 'high', access: 'dev', role: 'score', when: 'every' })
    metric = requireString(score.c.metric, 'checks.score.metric', errors)
    if (score.c.direction === 'minimize' || score.c.direction === 'maximize') {
      direction = score.c.direction
    } else {
      errors.push('checks.score.direction: must be "minimize" or "maximize"')
    }
  } else {
    errors.push('checks.score: required — a loop needs a score check (design principle P1)')
  }
  if (sealed) {
    verifiers.push({
      id: 'sealed',
      run: sealed.run,
      timeoutMs: sealed.timeoutMs,
      trust: 'high',
      access: 'sealed',
      role: preset?.sealedRole ?? 'gate',
      when: 'on_accept',
    })
  } else {
    warnings.push('checks.sealed: missing — nothing re-checks candidates the worker never saw')
  }
  for (const v of verifiers) {
    if (/\{worktree\}[\\/]/.test(v.run) && !/--candidate/.test(v.run)) {
      warnings.push(`checks.${v.id}: runs a file inside the worktree — the worker could change its own grader`)
    }
  }

  const maxIterations = budget.max_iterations
  if (!(typeof maxIterations === 'number' && Number.isInteger(maxIterations) && maxIterations > 0)) {
    errors.push('budget.max_iterations: required, a positive integer (design principle P6)')
  }

  const disallowed = [
    ...classDefaults.worker.disallowedTools,
    ...asStrings(worker.disallowed_tools, 'worker.disallowed_tools', errors),
  ]
  const allowed = asStrings(worker.allowed_tools, 'worker.allowed_tools', errors)
  for (const t of allowed) {
    if (/git push|competitions submit/.test(t)) warnings.push(`worker.allowed_tools: "${t}" allows an irreversible outside action`)
  }

  const ov = (key: string) => (overrides[key] === undefined ? undefined : overrides[key])
  const relative = typeof ov('relative') === 'number' ? (ov('relative') as number) : preset?.relative ?? 0
  const seMultiplier =
    ov('se_multiplier') === null || typeof ov('se_multiplier') === 'number'
      ? (ov('se_multiplier') as number | null)
      : preset?.seMultiplier ?? null
  const plateauWindow = typeof ov('plateau_window') === 'number' ? (ov('plateau_window') as number) : preset?.plateau.window

  const spec: Spec = {
    version: 1,
    class: CLASS_NAME,
    preset: presetName,
    name,
    description: typeof r.description === 'string' ? r.description : '',
    goal: {
      objective: requireString(goal.objective, 'goal.objective', errors),
      constraints: asStrings(goal.constraints, 'goal.constraints', errors),
    },
    workspace: {
      repo: requireString(workspace.repo, 'workspace.repo', errors).replace(/\\/g, '/'),
      baseRef: typeof workspace.base_ref === 'string' ? workspace.base_ref : 'HEAD',
      editable,
      protected: protectedPaths,
    },
    worker: {
      model: typeof worker.model === 'string' ? worker.model : classDefaults.worker.model,
      instructions: requireString(worker.instructions, 'worker.instructions', errors),
      operators: classDefaults.worker.operators,
      permissionMode:
        typeof worker.permission_mode === 'string' ? worker.permission_mode : classDefaults.worker.permissionMode,
      allowedTools: allowed,
      disallowedTools: [...new Set(disallowed)],
      timeoutMs:
        parseDuration(worker.timeout ?? classDefaults.worker.timeout, 'worker.timeout', errors) ?? 30 * 60e3,
      settingsEnv: { ...classDefaults.worker.settingsEnv, ...stringMap(worker.env, 'worker.env', errors) },
    },
    verifiers,
    acceptance: { verifier: 'score', metric, direction, relative, seMultiplier, paired: preset?.paired ?? false },
    memory: { ...classDefaults.memory },
    calibration: {
      repeats: classDefaults.calibration.repeats,
      knownBad: typeof r.known_bad === 'string' ? r.known_bad.replace(/\\/g, '/') : null,
    },
    budget: {
      maxIterations: typeof maxIterations === 'number' ? maxIterations : 0,
      wallClockMs: parseDuration(budget.wall_clock, 'budget.wall_clock', errors),
      usd: typeof budget.usd === 'number' ? budget.usd : null,
    },
    stop: {
      plateau: plateauWindow ? { window: plateauWindow } : null,
      debugChain: { ...classDefaults.stop.debugChain },
      divergence: preset?.divergence ?? null,
      anomaly: preset?.anomaly ?? null,
    },
    humanGates: { ...classDefaults.humanGates },
    onExit: { ...classDefaults.onExit },
  }
  if (!spec.calibration.knownBad) {
    warnings.push('known_bad: missing — the start check cannot confirm the grader rejects a bad candidate')
  }
  return { spec: errors.length ? null : spec, errors, warnings }
}

export function loadSpec(path: string): ExpandResult & { text: string } {
  const text = readFileSync(path, 'utf8')
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (err) {
    return { spec: null, errors: [`YAML: ${(err as Error).message}`], warnings: [], text }
  }
  return { ...expandSpec(raw), text }
}
