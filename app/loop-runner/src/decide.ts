// Pure decision logic: acceptance, operator choice and stop conditions. No I/O, so every
// rule here is unit-tested directly (test/decide.test.ts).

import type { CheckOutput, Scored, Spec, TerminalReason, Verdict } from './types'

export interface Judgement {
  accept: boolean
  /** Improvement in the "better" direction (positive = better than best). */
  delta: number
  /** Standard error of `delta`, when the checks report one (or cases allow pairing). */
  deltaSe: number | null
  threshold: number
}

/** Pull the scored value (and its noise, if any) out of a score check's output. */
export function scoredFrom(
  out: CheckOutput,
  metric: string,
  iteration: number,
  commit: string,
): Scored | null {
  const value = out.metrics?.[metric]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const se = typeof out.se?.[metric] === 'number' ? out.se[metric] : null
  const cases = Array.isArray(out.cases)
    ? out.cases
        .filter((c) => typeof c[metric] === 'number')
        .map((c) => ({ id: String(c.id), value: c[metric] as number }))
    : null
  return { iteration, commit, value, se, cases: cases && cases.length ? cases : null }
}

/**
 * Accept when the candidate beats the best by more than the noise:
 *   delta > max(relative * |best|, seMultiplier * se)
 * With `paired`, and both sides reporting the same case ids, `delta` is the mean per-case
 * difference and `se` its standard error — the same seeds/folds cancel most of the luck.
 */
export function judge(candidate: Scored, best: Scored, acc: Spec['acceptance']): Judgement {
  const sign = acc.direction === 'minimize' ? -1 : 1
  let delta = sign * (candidate.value - best.value)
  let deltaSe: number | null = null

  if (acc.paired && candidate.cases && best.cases) {
    const bestById = new Map(best.cases.map((c) => [c.id, c.value]))
    const diffs = candidate.cases
      .filter((c) => bestById.has(c.id))
      .map((c) => sign * (c.value - bestById.get(c.id)!))
    if (diffs.length >= 2) {
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
      const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (diffs.length - 1)
      delta = mean
      deltaSe = Math.sqrt(variance / diffs.length)
    }
  }
  if (deltaSe === null && candidate.se !== null && best.se !== null) {
    deltaSe = Math.sqrt(candidate.se ** 2 + best.se ** 2)
  }

  const relativeBar = acc.relative * Math.abs(best.value)
  const noiseBar = acc.seMultiplier !== null && deltaSe !== null ? acc.seMultiplier * deltaSe : 0
  const threshold = Math.max(relativeBar, noiseBar)
  return { accept: delta > threshold, delta, deltaSe, threshold }
}

/** An improvement so large it deserves a human look before it's accepted. */
export function isAnomaly(j: Judgement, anomaly: Spec['stop']['anomaly']): boolean {
  return !!anomaly && j.deltaSe !== null && j.deltaSe > 0 && j.delta > anomaly.seMultiplier * j.deltaSe
}

/** What the loop remembers between iterations; rebuilt from the journal on resume. */
export interface LoopState {
  startedAt: number
  iterationsDone: number
  best: Scored
  /** Commit the next iteration starts from (best, or a failed candidate under debug). */
  head: string
  /** improve iterations in a row that weren't accepted (debug iterations don't count). */
  improveMisses: number
  /** Consecutive failed debug attempts on the current broken candidate, or null. */
  debug: { candidate: string; attempts: number; error: string } | null
  integrityViolations: number
  costUsd: number
  /** Added by budget-gate "extend" decisions. */
  extraIterations?: number
  extraWallClockMs?: number
}

export function nextOperator(state: LoopState): 'improve' | 'debug' {
  return state.debug ? 'debug' : 'improve'
}

/** Why the loop must stop before starting another iteration, or null to keep going. */
export function stopReason(state: LoopState, spec: Spec, now: number): TerminalReason | null {
  if (state.iterationsDone >= spec.budget.maxIterations + (state.extraIterations ?? 0)) return 'max_iterations'
  if (
    spec.budget.wallClockMs !== null &&
    now - state.startedAt >= spec.budget.wallClockMs + (state.extraWallClockMs ?? 0)
  ) {
    return 'budget_time'
  }
  if (spec.budget.usd !== null && state.costUsd >= spec.budget.usd) return 'budget_usd'
  if (spec.stop.plateau && state.improveMisses >= spec.stop.plateau.window) return 'plateau'
  if (state.integrityViolations >= 2) return 'integrity_violation'
  return null
}

/**
 * Fold one finished iteration into the state. `candidate` is the scored version when the
 * verdict is `accepted`; `commit` is the iteration's commit (for debug bookkeeping).
 */
export function applyIteration(
  state: LoopState,
  spec: Spec,
  it: {
    operator: 'improve' | 'debug'
    verdict: Verdict
    commit: string | null
    candidate: Scored | null
    costUsd: number
    error?: string
  },
): LoopState {
  const next: LoopState = { ...state, iterationsDone: state.iterationsDone + 1, costUsd: state.costUsd + it.costUsd }
  if (it.verdict === 'accepted' && it.candidate) {
    next.best = it.candidate
    next.head = it.candidate.commit
    next.improveMisses = 0
    next.debug = null
    return next
  }
  if (it.verdict === 'integrity_violation') next.integrityViolations = state.integrityViolations + 1

  // A broken candidate gets up to `debugChain.max` debug attempts before it's abandoned.
  if (it.verdict === 'bug' && it.commit && spec.worker.operators.includes('debug')) {
    const attempts = it.operator === 'debug' && state.debug ? state.debug.attempts + 1 : 1
    if (it.operator === 'improve') next.improveMisses = state.improveMisses + 1
    if (attempts <= spec.stop.debugChain.max) {
      next.debug = { candidate: it.commit, attempts, error: it.error ?? '' }
      next.head = it.commit
      return next
    }
  } else if (it.operator === 'improve') {
    next.improveMisses = state.improveMisses + 1
  }
  next.debug = null
  next.head = state.best.commit
  return next
}
