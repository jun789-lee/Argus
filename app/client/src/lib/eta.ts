// Progress / ETA estimates for open-ended agent work, learned from past
// runs of the same kind (the server returns durations of finished
// subagents, so estimates sharpen as history accumulates).
//
// Agents don't know their total work up front, so there is no true %.
// Instead: given the task has already run `elapsed`, look only at past
// runs that lasted at least that long and take their median as the
// expected total. This conditional median keeps the estimate honest for
// long tasks: a plain average would sit at "99%" forever.

export const MIN_SAMPLES = 3
const MAX_SHOWN_PROGRESS = 0.95

export interface Estimate {
  /** 0–0.95; never claims done before the task actually finishes. */
  progress: number
  /** Expected time left, ms. */
  remainingMs: number
  /** Median duration of all past runs of this kind. */
  typicalMs: number
  /** Longer than every past run of this kind. */
  overdue: boolean
  samples: number
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Null when there isn't enough history to say anything useful. */
export function estimateProgress(elapsedMs: number, pastDurationsMs: number[]): Estimate | null {
  const sorted = pastDurationsMs.filter((d) => d > 0).sort((a, b) => a - b)
  if (sorted.length < MIN_SAMPLES) return null
  const typicalMs = median(sorted)
  const longer = sorted.filter((d) => d > elapsedMs)
  if (longer.length === 0) {
    return {
      progress: MAX_SHOWN_PROGRESS,
      remainingMs: 0,
      typicalMs,
      overdue: true,
      samples: sorted.length,
    }
  }
  const expectedTotal = median(longer)
  return {
    progress: Math.min(MAX_SHOWN_PROGRESS, Math.max(0, elapsedMs / expectedTotal)),
    remainingMs: Math.max(0, expectedTotal - elapsedMs),
    typicalMs,
    overdue: false,
    samples: sorted.length,
  }
}

/** Past durations for an agent type, falling back to all subagents. */
export function samplesFor(
  stats:
    | { byType: Record<string, { durationsMs: number[] }>; all: { durationsMs: number[] } }
    | null
    | undefined,
  agentType: string | null,
): { durations: number[]; scope: 'type' | 'all' } | null {
  if (!stats) return null
  const typed = agentType ? stats.byType[agentType]?.durationsMs : undefined
  if (typed && typed.length >= MIN_SAMPLES) return { durations: typed, scope: 'type' }
  if (stats.all.durationsMs.length >= MIN_SAMPLES)
    return { durations: stats.all.durationsMs, scope: 'all' }
  return null
}

/** No events for this long on a running task looks stuck. */
export function stallThresholdMs(typicalMs: number | null): number {
  return Math.max(3 * 60_000, typicalMs ? typicalMs * 0.5 : 0)
}
