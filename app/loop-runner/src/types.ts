// Expanded loop spec: what the runner executes after a short, class-based spec has been
// filled in from its class and preset (see docs/specs/2026-10-29-auto-loop-design.md §5).

export type Direction = 'minimize' | 'maximize'
export type Trust = 'high' | 'medium' | 'low'
export type Access = 'dev' | 'sealed'
export type Role = 'gate' | 'score' | 'watch'
export type When = 'every' | 'on_accept' | 'final'

export interface Verifier {
  id: string
  run: string
  timeoutMs: number
  trust: Trust
  access: Access
  role: Role
  when: When
}

export interface Spec {
  version: 1
  class: string
  preset: string
  name: string
  description: string
  goal: { objective: string; constraints: string[] }
  workspace: { repo: string; baseRef: string; editable: string[]; protected: string[] }
  worker: {
    model: string
    instructions: string
    operators: Array<'improve' | 'debug'>
    permissionMode: string
    allowedTools: string[]
    disallowedTools: string[]
    timeoutMs: number
    /** Passed as `claude -p --settings '{"env": ...}'`: flag settings win over the user's
     *  settings.json env, which a plain process env var does not. */
    settingsEnv: Record<string, string>
  }
  verifiers: Verifier[]
  acceptance: {
    verifier: string
    metric: string
    direction: Direction
    relative: number
    seMultiplier: number | null
    paired: boolean
  }
  memory: { showLast: number; reflections: number }
  calibration: { repeats: number; knownBad: string | null }
  budget: { maxIterations: number; wallClockMs: number | null; usd: number | null }
  stop: {
    plateau: { window: number } | null
    debugChain: { max: number }
    divergence: { window: number } | null
    anomaly: { seMultiplier: number } | null
  }
  humanGates: { start: 'required' | 'auto'; onAlert: 'pause' | 'stop'; onBudgetEnd: 'ask' | 'stop' }
  onExit: { keepTop: number }
}

// The verifier contract: the last non-empty stdout line of a check is this JSON.
export interface CheckOutput {
  ok: boolean
  metrics: Record<string, number>
  se?: Record<string, number>
  cases?: Array<{ id: string; [metric: string]: number | string }>
  message?: string
}

export interface CheckResult extends CheckOutput {
  id: string
  durationMs: number
  timedOut: boolean
  /** Set when the check command itself broke (bad JSON, crash) rather than the candidate. */
  infraError?: string
}

/** A scored version: the baseline (iteration 0) or an accepted candidate. */
export interface Scored {
  iteration: number
  commit: string
  value: number
  se: number | null
  cases: Array<{ id: string; value: number }> | null
}

export type Verdict =
  | 'accepted'
  | 'rejected'
  | 'no_change'
  | 'bug'
  | 'timeout'
  | 'out_of_scope'
  | 'integrity_violation'
  | 'error'

export type TerminalReason =
  | 'success'
  | 'max_iterations'
  | 'budget_time'
  | 'budget_usd'
  | 'plateau'
  | 'integrity_violation'
  | 'escalated'
  | 'user_stopped'
  | 'error'

export interface WorkerReport {
  hypothesis: string
  change_summary: string
  lesson?: string
  needs_human: boolean
  needs_human_reason?: string
}
