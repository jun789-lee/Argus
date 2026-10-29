import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { resolveTranscriptPath } from '../services/transcript-path'
import { parseSessionTranscripts } from '../transcript-parser'
import { readCacheStatus } from '../services/cache-status'
import { readAssistantMessages } from '../services/assistant-messages'
import { readToolAvailability } from '../services/tool-availability'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// Prompt-cache expiry estimate for the dashboard countdown. Cheap: reads
// only the tail of the transcript in the common case.
router.get('/sessions/:sessionId/cache-status', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json({ error: 'disabled', message: 'Transcript parsing is disabled.' }, 404)
  }
  const store = c.get('store')
  const hostPath = await store.getSessionTranscriptPath(c.req.param('sessionId'))
  if (!hostPath) {
    return c.json({ error: 'no_transcript', message: 'No transcript path found for session.' }, 404)
  }
  const resolved = resolveTranscriptPath(hostPath, config.transcriptStats.bases)
  try {
    return c.json(await readCacheStatus(resolved, config.transcriptStats.maxFileBytes), 200)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'file_not_found', message: 'Transcript file not found.' }, 404)
    }
    if (err?.code === 'EACCES') {
      return c.json({ error: 'file_unreadable', message: err.message }, 403)
    }
    throw err
  }
})

// Whether Claude had its to-do list tools (TaskCreate / TodoWrite) in this
// session — the plan tab warns when they're missing.
router.get('/sessions/:sessionId/tool-availability', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json({ error: 'disabled', message: 'Transcript parsing is disabled.' }, 404)
  }
  const hostPath = await c.get('store').getSessionTranscriptPath(c.req.param('sessionId'))
  if (!hostPath) {
    return c.json({ error: 'no_transcript', message: 'No transcript path found for session.' }, 404)
  }
  const resolved = resolveTranscriptPath(hostPath, config.transcriptStats.bases)
  try {
    return c.json(await readToolAvailability(resolved, config.transcriptStats.maxFileBytes), 200)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'file_not_found', message: 'Transcript file not found.' }, 404)
    }
    if (err?.code === 'EACCES') {
      return c.json({ error: 'file_unreadable', message: err.message }, 403)
    }
    throw err
  }
})

// Claude's text replies for the prompt view's conversation log.
//   ?promptId=…  main-chain replies to that prompt (session transcript);
//                comma-separated to include merged task-notification turns
//   ?agentId=…   a subagent's replies (its own transcript, whose path the
//                SubagentStop hook reported as agent_transcript_path)
router.get('/sessions/:sessionId/assistant-messages', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json({ error: 'disabled', message: 'Transcript parsing is disabled.' }, 404)
  }
  const sessionId = c.req.param('sessionId')
  const promptId = c.req.query('promptId') || null
  const agentId = c.req.query('agentId') || null
  const store = c.get('store')

  let hostPath: string | null = null
  if (agentId) {
    const stops = await store.getEventsForSession(sessionId, { hookName: 'SubagentStop' })
    for (const e of stops) {
      try {
        const p = JSON.parse(e.payload)
        if (p?.agent_id === agentId && typeof p.agent_transcript_path === 'string') {
          hostPath = p.agent_transcript_path
        }
      } catch {
        // skip malformed payloads
      }
    }
  } else {
    hostPath = await store.getSessionTranscriptPath(sessionId)
  }
  if (!hostPath) {
    return c.json({ error: 'no_transcript', message: 'No transcript path found.' }, 404)
  }

  const resolved = resolveTranscriptPath(hostPath, config.transcriptStats.bases)
  try {
    const messages = await readAssistantMessages(resolved, config.transcriptStats.maxFileBytes, {
      promptId: agentId ? null : promptId,
      includeSidechain: !!agentId,
    })
    return c.json({ messages }, 200)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'file_not_found', message: 'Transcript file not found.' }, 404)
    }
    if (err?.code === 'EACCES') {
      return c.json({ error: 'file_unreadable', message: err.message }, 403)
    }
    if (err?.code === 'E2BIG') {
      return c.json({ error: 'file_too_large', message: err.message }, 413)
    }
    throw err
  }
})

router.get('/sessions/:sessionId/transcript-stats', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json(
      {
        error: 'disabled',
        message:
          'Transcript parsing is disabled. Unset AGENTS_OBSERVE_TRANSCRIPT_STATS (or remove the =0 override) on the server to re-enable.',
      },
      404,
    )
  }

  const sessionId = c.req.param('sessionId')
  const store = c.get('store')
  const hostPath = await store.getSessionTranscriptPath(sessionId)
  if (!hostPath) {
    return c.json({ error: 'no_transcript', message: 'No transcript path found for session.' }, 404)
  }

  const resolved = resolveTranscriptPath(hostPath, config.transcriptStats.bases)

  let stat
  try {
    stat = await fs.stat(resolved)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'file_not_found', message: 'Transcript file not found.' }, 404)
    }
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    throw err
  }

  if (stat.size > config.transcriptStats.maxFileBytes) {
    return c.json(
      {
        error: 'file_too_large',
        message: `Transcript file exceeds the ${Math.round(
          config.transcriptStats.maxFileBytes / 1024 / 1024,
        )} MB safety cap.`,
      },
      413,
    )
  }

  try {
    const stats = await parseSessionTranscripts(sessionId, store, resolved)
    return c.json(stats, 200)
  } catch (err: any) {
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    return c.json({ error: 'parse_error', message: err?.message ?? String(err) }, 500)
  }
})

export default router
