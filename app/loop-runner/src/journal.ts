// The run's source of truth: an append-only JSONL file the runner alone writes. Argus mirrors
// it for display; resuming a run replays it.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
/** What the run is doing now (design §6.4); the dashboard's loop ring follows it. */
export type LoopPhase =
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
export interface StateEvent {
  type: 'state'
  state: LoopPhase
  n?: number
}
/** Written when a worker starts, so the dashboard links the live session to its iteration. */
export interface IterationStartedEvent {
  type: 'iteration_started'
  n: number
  operator: 'improve' | 'debug'
  sessionId: string | null
  startCommit: string
}
export type GateKind = 'start' | 'alert' | 'budget' | 'review'
/** Decisions per kind: start: start | cancel; alert: continue | reject | stop;
 *  budget: extend | finish; review: ack. */
export interface GateRequestedEvent {
  type: 'gate_requested'
  id: string
  kind: GateKind
  request: { reason: string; [key: string]: unknown }
}
export interface GateEvent {
  type: 'gate'
  /** Absent on gates recorded before gate ids existed. */
  id?: string
  kind: GateKind
  reason: string
  decision: string
  by: 'terminal' | 'auto' | 'ui'
}
export interface BudgetExtendedEvent {
  type: 'budget_extended'
  iterations: number
  wallClockMs: number | null
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
  | StateEvent
  | IterationStartedEvent
  | GateRequestedEvent
  | BudgetExtendedEvent
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

// ── Control: decisions and stop requests from outside (the Argus dashboard) ─────────
// The dashboard appends to runs/<id>/control.jsonl; the runner only reads it. Keeping the
// two files apart means the journal stays the runner's alone.

export type ControlEvent =
  | { t?: string; type: 'gate_decision'; gateId: string; decision: string; by?: string }
  | { t?: string; type: 'stop'; by?: string }

export function controlPath(runDir: string) {
  return join(runDir, 'control.jsonl')
}

export function readControl(runDir: string): ControlEvent[] {
  const p = controlPath(runDir)
  if (!existsSync(p)) return []
  const out: ControlEvent[] = []
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as ControlEvent)
    } catch {
      /* a half-written line: picked up on the next read */
    }
  }
  return out
}

export function appendControl(runDir: string, event: ControlEvent) {
  appendFileSync(controlPath(runDir), JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n')
}

export function iterations(events: JournalEvent[]): IterationEvent[] {
  return events.filter((e): e is IterationEvent & { t?: string } => e.type === 'iteration')
}
