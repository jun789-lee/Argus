// Auto-loop runs as the dashboard sees them. The shapes follow the server
// contract in docs/specs/2026-10-29-auto-loop-design.md §10 (tables
// loop_runs / loop_iterations / loop_gates, camelCased over the API); the
// runner itself (app/loop-runner) mirrors its journal into them.
// cycleFromRun maps a run onto the same plan → execute → evaluate → decide
// ring used for ordinary missions, with one lap per iteration.

import type { CycleModel, LapScore, StageItem, StageKey, StageState, StageStatus } from './cycle'
import { STAGES } from './cycle'

/** Runner phases (§6.4). Unknown values are tolerated and shown as-is. */
export type LoopState =
  | 'preparing'
  | 'calibrating'
  | 'awaiting_start'
  | 'working'
  | 'checking'
  | 'judging'
  | 'alert'
  | 'paused'
  | 'finishing'
  | 'finished'

/** Mirrors the runner's Verdict type. */
export type LoopVerdict =
  | 'accepted'
  | 'rejected'
  | 'no_change'
  | 'bug'
  | 'timeout'
  | 'out_of_scope'
  | 'integrity_violation'
  | 'error'

export interface LoopRun {
  id: string
  loopName: string
  state: LoopState | string
  terminalReason: string | null
  repo?: string | null
  branch?: string | null
  bestIteration: number | null
  baselineScore: number | null
  bestScore: number | null
  /** 'maximize' unless the spec says otherwise. */
  direction?: 'maximize' | 'minimize'
  iterationsDone: number
  /** budget.maxIterations, when the runner reports it. */
  iterationsMax?: number | null
  costUsd: number
  startedAt: number
  endedAt: number | null
}

export interface LoopIteration {
  runId: string
  n: number
  operator?: 'improve' | 'debug' | string
  sessionId: string | null
  commit?: string | null
  hypothesis?: string | null
  /** null while the iteration is still running. */
  verdict: LoopVerdict | string | null
  score: number | null
  delta?: number | null
  deltaSe?: number | null
  sealedScore?: number | null
  costUsd?: number
  durationS?: number | null
}

export interface LoopGate {
  id: string
  runId: string
  kind: 'start' | 'alert' | 'budget' | 'review' | string
  state: 'pending' | 'decided'
  request?: Record<string, unknown> | null
  decision?: string | null
  decidedBy?: 'ui' | 'terminal' | string | null
  createdAt: number
  decidedAt?: number | null
}

export interface LoopRunDetail {
  run: LoopRun
  iterations: LoopIteration[]
  gates: LoopGate[]
}

const BAD_VERDICTS = new Set(['bug', 'error', 'timeout', 'integrity_violation', 'out_of_scope'])

export function scoreKind(verdict: LoopIteration['verdict']): LapScore['kind'] {
  if (verdict === 'accepted') return 'accepted'
  if (verdict && BAD_VERDICTS.has(verdict)) return 'bug'
  return 'rejected'
}

/** Which ring stage a runner phase belongs to (null: idle / over). */
export function stageOfState(state: LoopRun['state']): StageKey | null {
  switch (state) {
    case 'preparing':
    case 'calibrating':
    case 'awaiting_start':
      return 'plan'
    case 'working':
      return 'execute'
    case 'checking':
      return 'evaluate'
    case 'judging':
    case 'alert':
    case 'finishing':
      return 'decide'
    default:
      return null
  }
}

/** Relative improvement of best over baseline, signed so that up = better. */
export function improvement(run: LoopRun): number | null {
  if (run.bestScore == null || run.baselineScore == null || run.baselineScore === 0) return null
  const raw = (run.bestScore - run.baselineScore) / Math.abs(run.baselineScore)
  return run.direction === 'minimize' ? -raw : raw
}

export function cycleFromRun({ run, iterations, gates }: LoopRunDetail): CycleModel {
  const its = [...iterations].sort((a, b) => a.n - b.n)
  const current = stageOfState(run.state)
  const finished = run.state === 'finished' || run.endedAt !== null
  const live = its.filter((i) => i.verdict === null)
  const latest = live[live.length - 1] ?? its[its.length - 1] ?? null
  const pending = gates.filter((g) => g.state === 'pending')

  const planItems: StageItem[] = []
  if (run.baselineScore != null) {
    planItems.push({ id: 'baseline', label: `${run.baselineScore}`, icon: '📐', state: 'done' })
  }
  for (const g of pending.filter((g) => g.kind === 'start')) {
    planItems.push({ id: `gate-${g.id}`, label: 'awaiting_start', icon: '✋', state: 'running' })
  }

  const executeItems: StageItem[] = latest
    ? [
        {
          id: `it-${latest.n}`,
          label: latest.hypothesis ?? `#${latest.n}`,
          detail: latest.operator ?? null,
          icon: '🧑‍💻',
          nodeId: latest.sessionId ?? undefined,
          state: latest.verdict === null ? 'running' : 'done',
        },
      ]
    : []

  const scored = its.filter((i) => i.score !== null)
  const evaluateItems: StageItem[] = scored.slice(-3).map((i) => ({
    id: `score-${i.n}`,
    label: `#${i.n} ${i.score}${i.deltaSe != null ? ` ±${i.deltaSe}` : ''}`,
    detail: i.sealedScore != null ? `sealed ${i.sealedScore}` : null,
    icon: '📏',
    nodeId: i.sessionId ?? undefined,
    state: scoreKind(i.verdict) === 'bug' ? 'failed' : 'done',
  }))

  const decideItems: StageItem[] = [
    ...pending
      .filter((g) => g.kind !== 'start')
      .map((g) => ({ id: `gate-${g.id}`, label: g.kind, icon: '🚨', state: 'running' as const })),
    ...its
      .filter((i) => i.verdict !== null)
      .slice(-4)
      .map((i) => ({
        id: `verdict-${i.n}`,
        label: `#${i.n} ${i.verdict}`,
        icon: i.verdict === 'accepted' ? '✅' : scoreKind(i.verdict) === 'bug' ? '❌' : '↩️',
        nodeId: i.sessionId ?? undefined,
        state: (i.verdict === 'accepted' ? 'done' : 'failed') as StageItem['state'],
      })),
  ]

  const itemsBy: Record<StageKey, StageItem[]> = {
    plan: planItems,
    execute: executeItems,
    evaluate: evaluateItems,
    decide: decideItems,
  }
  const started = its.length > 0
  const statusOf = (k: StageKey): StageStatus => {
    if (current === k && !finished) return 'active'
    if (finished) return itemsBy[k].length > 0 ? 'done' : 'skipped'
    if (!started) return k === 'plan' ? 'done' : 'idle'
    return itemsBy[k].length > 0 ? 'done' : 'idle'
  }
  const stages = Object.fromEntries(
    STAGES.map((k) => [k, { status: statusOf(k), items: itemsBy[k] } satisfies StageState]),
  ) as Record<StageKey, StageState>

  return {
    stages,
    current: finished ? null : current,
    lap: Math.max(run.iterationsDone, latest?.n ?? 0),
    laps: run.iterationsMax ?? null,
    scores: scored.map((i) => ({ value: i.score!, kind: scoreKind(i.verdict) })),
    delta: improvement(run),
    progress: null,
    team: [{ label: 'Worker', icon: '🧑‍💻' }],
  }
}
