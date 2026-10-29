import { describe, test, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import type { EventStore } from '../storage/types'

let app: Hono<any>

beforeEach(async () => {
  const store = new SqliteAdapter(':memory:')
  const { default: eventsRouter } = await import('./events')
  const { default: statsRouter } = await import('./stats')
  app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    c.set('broadcastToSession', () => {})
    c.set('broadcastToAll', () => {})
    c.set('broadcastActivity', () => {})
    await next()
  })
  app.route('/api', eventsRouter)
  app.route('/api', statsRouter)
})

const S = 'sess-1'
async function post(agentId: string, hookName: string, timestamp: number, payload = {}) {
  const res = await app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentClass: 'claude-code',
      sessionId: S,
      agentId,
      hookName,
      timestamp,
      payload: { hook_event_name: hookName, ...payload },
    }),
  })
  expect(res.status).toBe(201)
}

describe('GET /api/stats/subagent-runs', () => {
  test('collects finished subagent runs by type, ending at SubagentStop or task-notification', async () => {
    // Explore agent, foreground: ends at SubagentStop (logged by the parent).
    await post('a1', 'SubagentStart', 1000, { agent_type: 'Explore' })
    await post('a1', 'PreToolUse', 1100, { tool_name: 'Read', tool_use_id: 'r1' })
    await post('a1', 'PreToolUse', 1200, { tool_name: 'Grep', tool_use_id: 'r2' })
    await post(S, 'SubagentStop', 4000, { agent_id: 'a1' })
    // general-purpose, background: ends at its task-notification.
    await post('a2', 'SubagentStart', 2000, { agent_type: 'general-purpose' })
    await post('a2', 'PreToolUse', 2100, { tool_name: 'WebSearch', tool_use_id: 'w1' })
    await post(S, 'UserPromptSubmit', 9000, {
      prompt:
        '<task-notification>\n<task-id>a2</task-id>\n<status>completed</status>\n</task-notification>',
    })
    // Foreground, no SubagentStart/Stop: ends at its Agent call's 'completed' response.
    await post('a4', 'PreToolUse', 3000, { tool_name: 'WebFetch', tool_use_id: 'f1' })
    await post(S, 'PostToolUse', 5500, {
      tool_name: 'Agent',
      tool_use_id: 'call-a4',
      tool_response: { status: 'completed', agentId: 'a4', agentType: 'web-fetch' },
    })
    // Still running: no stop yet — excluded.
    await post('a3', 'SubagentStart', 5000, { agent_type: 'Explore' })

    const res = await app.request('/api/stats/subagent-runs')
    const body = (await res.json()) as any
    expect(body.total).toBe(3)
    expect(body.byType['web-fetch']).toEqual({ durationsMs: [2500], tools: [1] })
    expect(body.byType.Explore).toEqual({ durationsMs: [3000], tools: [2] })
    expect(body.byType['general-purpose']).toEqual({ durationsMs: [7000], tools: [1] })
    expect(body.all.durationsMs.sort((a: number, b: number) => a - b)).toEqual([2500, 3000, 7000])
  })
})
