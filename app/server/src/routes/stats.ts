// History used by the dashboard's ETA estimates. Computed from the event
// log on each request, so every newly finished subagent sharpens the
// estimates without any extra bookkeeping.

import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

/** Per-type samples kept for the estimator (newest first). */
const MAX_SAMPLES_PER_TYPE = 200

export interface RunSamples {
  durationsMs: number[]
  tools: number[]
}

router.get('/stats/subagent-runs', async (c) => {
  const runs = await c.get('store').getSubagentRuns()
  const byType: Record<string, RunSamples> = {}
  const all: RunSamples = { durationsMs: [], tools: [] }
  for (const run of runs) {
    const key = run.agentType ?? 'unknown'
    const bucket = (byType[key] ??= { durationsMs: [], tools: [] })
    if (bucket.durationsMs.length < MAX_SAMPLES_PER_TYPE) {
      bucket.durationsMs.push(run.durationMs)
      bucket.tools.push(run.tools)
    }
    if (all.durationsMs.length < MAX_SAMPLES_PER_TYPE) {
      all.durationsMs.push(run.durationMs)
      all.tools.push(run.tools)
    }
  }
  return c.json({ byType, all, total: runs.length })
})

export default router
