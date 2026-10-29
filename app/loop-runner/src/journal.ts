// The run's source of truth: an append-only JSONL file the runner alone writes. Argus mirrors
// it for display; resuming a run replays it.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { CheckResult, Scored, Spec, TerminalReason, Verdict, WorkerReport } from './types'
import type { Judgement } from './decide'

export interface RunStartedEvent {
  type: 'run_started'
  runId: string
  loop: string
  specText: string
  spec: Spec
  worktree: string
  branch: string
  baseCommit: string
  graderHashes: Record<string, string>
}
export interface CalibrationEvent {
  type: 'calibration'
  baseline: Scored
  checks: CheckResult[]
  knownBad: CheckResult | null
  warnings: string[]
}
export interface GateEvent {
  type: 'gate'
  kind: 'start' | 'alert'
  reason: string
  decision: 'continue' | 'stop'
  by: 'terminal' | 'auto'
}
export interface IterationEvent {
  type: 'iteration'
  n: number
  operator: 'improve' | 'debug'
  sessionId: string | null
  startCommit: string
  commit: string | null
  report: WorkerReport | null
  workerExit: string
  changedFiles: string[]
  checks: CheckResult[]
  verdict: Verdict
  judgement: Judgement | null
  scored: Scored | null
  /** The exact text the next worker sees about this iteration. */
  feedback: string
  /** Kept for debug follow-ups; never shown for sealed checks. */
  error: string | null
  costUsd: number
  durationMs: number
}
/** Written right after a candidate is committed and before it is scored, so a run that
 *  stops while scoring (a grader that can't start, a crash) resumes by re-scoring this
 *  commit instead of asking a worker to redo the attempt. */
export interface CandidateEvent {
  type: 'candidate'
  n: number
  operator: 'improve' | 'debug'
  sessionId: string | null
  startCommit: string
  commit: string
  report: WorkerReport | null
  workerExit: string
  changedFiles: string[]
  costUsd: number
  workerMs: number
  /** Set when the event was reconstructed by hand from the logs. */
  note?: string
}
export interface RunFinishedEvent {
  type: 'run_finished'
  reason: TerminalReason
  best: Scored
  baseline: Scored
  iterations: number
  costUsd: number
}
export type JournalEvent = (
  | RunStartedEvent
  | CalibrationEvent
  | GateEvent
  | IterationEvent
  | CandidateEvent
  | RunFinishedEvent
) & { t?: string }

export function append(path: string, event: JournalEvent) {
  appendFileSync(path, JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n')
}

export function read(path: string): JournalEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as JournalEvent)
}

/** The candidate of iteration `n` if it was committed but never scored. */
export function pendingCandidate(events: JournalEvent[], n: number): CandidateEvent | null {
  if (events.some((e) => e.type === 'iteration' && e.n === n)) return null
  const c = events.filter((e): e is CandidateEvent & { t?: string } => e.type === 'candidate' && e.n === n).at(-1)
  return c ?? null
}

export function iterations(events: JournalEvent[]): IterationEvent[] {
  return events.filter((e): e is IterationEvent & { t?: string } => e.type === 'iteration')
}
