// The `ml-improve` class ("ML 자동 개선"): the fixed structure every competition loop shares,
// plus per-competition-type presets. A short spec only fills in what differs per competition;
// expandSpec() merges spec > preset > class defaults.
//
// Changing a default here changes it for every loop of this class — that's the point.

import type { Role } from '../types'

export const CLASS_NAME = 'ml-improve'

export const classDefaults = {
  worker: {
    model: 'opus',
    operators: ['improve', 'debug'] as Array<'improve' | 'debug'>,
    permissionMode: 'bypassPermissions',
    allowedTools: [] as string[],
    // Irreversible outside actions stay blocked even with full permissions (design G10).
    disallowedTools: ['Bash(git push*)', 'Bash(kaggle competitions submit*)'],
    timeout: '30m',
    // Turn off the Argus plan-tracking nudge for workers (it asks every prompt for a to-do
    // list). It must go through --settings: the user's settings.json sets it to 1, and that
    // wins over the worker's process environment. Argus still records the session.
    settingsEnv: { AGENTS_OBSERVE_PLAN_NUDGE: '0' } as Record<string, string>,
  },
  checkTimeout: '20m',
  memory: { showLast: 5, reflections: 3 },
  calibration: { repeats: 2 },
  stop: { debugChain: { max: 3 } },
  humanGates: { start: 'required', onAlert: 'pause', onBudgetEnd: 'ask' } as const,
  onExit: { keepTop: 3 },
}

export interface Preset {
  /** Minimum relative improvement to accept. */
  relative: number
  /** Improvement must also exceed this many standard errors, when the check reports one. */
  seMultiplier: number | null
  /** Compare candidate and best case by case (folds, seeds) when both report cases. */
  paired: boolean
  sealedRole: Role
  plateau: { window: number }
  divergence: { window: number } | null
  anomaly: { seMultiplier: number } | null
}

export const presets: Record<string, Preset> = {
  // Deterministic costs (same circuit -> same score): only a relative margin, and the sealed
  // check is a second, independent pass/fail gate.
  optimization: {
    relative: 0.001,
    seMultiplier: null,
    paired: false,
    sealedRole: 'gate',
    plateau: { window: 3 },
    divergence: null,
    anomaly: null,
  },
  // Noisy CV scores: paired per fold, sealed holdout watches for overfitting.
  data: {
    relative: 0.005,
    seMultiplier: 2,
    paired: true,
    sealedRole: 'watch',
    plateau: { window: 4 },
    divergence: { window: 2 },
    anomaly: { seMultiplier: 8 },
  },
  // Noisy match results: paired per seed, sealed seeds/opponents watch for overfitting.
  simulation: {
    relative: 0.01,
    seMultiplier: 2,
    paired: true,
    sealedRole: 'watch',
    plateau: { window: 4 },
    divergence: { window: 2 },
    anomaly: { seMultiplier: 8 },
  },
}
