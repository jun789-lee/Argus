import { describe, expect, test } from 'vitest'
import { buildTurnTree, parseTaskNotification, type TreeEvent } from './turn-tree'

const S = 'sess-1'
let nextId = 1
function ev(
  hookName: string,
  timestamp: number,
  payload: Record<string, unknown> = {},
  agentId = S,
): TreeEvent {
  return {
    id: nextId++,
    agentId,
    hookName,
    timestamp,
    payload: { hook_event_name: hookName, ...payload },
  }
}
const build = (events: TreeEvent[]) => buildTurnTree(events, { sessionId: S })

describe('buildTurnTree', () => {
  test('groups session-level hooks before the first prompt into a system node', () => {
    const roots = build([
      ev('SessionStart', 1),
      ev('ConfigChange', 2),
      ev('UserPromptSubmit', 3, { prompt_id: 'p1', prompt: 'Fix the bug\nmore detail' }),
      ev('PreToolUse', 4, { prompt_id: 'p1', tool_use_id: 't1', tool_name: 'Read' }),
      ev('PostToolUse', 5, { prompt_id: 'p1', tool_use_id: 't1', tool_name: 'Read' }),
      ev('Stop', 6, { prompt_id: 'p1' }),
    ])
    expect(roots.map((n) => n.kind)).toEqual(['system', 'prompt'])
    expect(roots[0].title).toBe('SessionStart · ConfigChange')
    const prompt = roots[1]
    expect(prompt.id).toBe('p1')
    expect(prompt.title).toBe('Fix the bug')
    expect(prompt.prompt).toBe('Fix the bug\nmore detail')
    expect(prompt.events.map((e) => e.hookName)).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Stop',
    ])
    expect(prompt).toMatchObject({ status: 'done', startedAt: 3, endedAt: 6, toolCount: 1 })
  })

  test('uses prompt_id even when events arrive out of the prompt window', () => {
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('Stop', 2, { prompt_id: 'p1' }),
      ev('Notification', 3, { prompt_id: 'p1' }), // after Stop, still p1's
      ev('UserPromptSubmit', 4, { prompt_id: 'p2', prompt: 'b' }),
    ])
    expect(roots.map((n) => n.id)).toEqual(['p1', 'p2'])
    expect(roots[0].events.map((e) => e.hookName)).toContain('Notification')
  })

  test('falls back to the open prompt when prompt_id is missing', () => {
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt: 'no ids here' }),
      ev('PreToolUse', 2, { tool_name: 'Bash' }),
      ev('Stop', 3),
      ev('PreToolUse', 4, { tool_name: 'Bash' }), // after Stop, no prompt open
    ])
    expect(roots.map((n) => n.kind)).toEqual(['prompt', 'system'])
    expect(roots[0].events).toHaveLength(3)
    expect(roots[1].events.map((e) => e.hookName)).toEqual(['PreToolUse'])
  })

  test('session hooks between prompts become their own system row', () => {
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('Stop', 2, { prompt_id: 'p1' }),
      ev('ConfigChange', 3, { prompt_id: 'p1' }),
      ev('UserPromptSubmit', 4, { prompt_id: 'p2', prompt: 'b' }),
    ])
    expect(roots.map((n) => n.kind)).toEqual(['prompt', 'system', 'prompt'])
  })

  test('nests subagents under the prompt that spawned them, with their prompt and type', () => {
    const A = 'agent-a'
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'research' }),
      ev('PreToolUse', 2, {
        prompt_id: 'p1',
        tool_name: 'Agent',
        tool_use_id: 'ta',
        tool_input: {
          description: 'Find files',
          prompt: 'Find all files',
          subagent_type: 'Explore',
        },
      }),
      ev('SubagentStart', 3, { agent_id: A, agent_type: 'Explore' }, A),
      ev('PreToolUse', 4, { tool_name: 'Grep', tool_use_id: 'g1' }, A),
      ev('PostToolUseFailure', 5, { tool_name: 'Grep', tool_use_id: 'g1' }, A),
      ev('SubagentStop', 6, { prompt_id: 'p1', agent_id: A }),
      ev('PostToolUse', 7, {
        prompt_id: 'p1',
        tool_name: 'Agent',
        tool_use_id: 'ta',
        tool_response: { agentId: A },
      }),
      ev('Stop', 8, { prompt_id: 'p1' }),
    ])
    expect(roots).toHaveLength(1)
    const [prompt] = roots
    expect(prompt.children).toHaveLength(1)
    const child = prompt.children[0]
    expect(child).toMatchObject({
      kind: 'subagent',
      id: A,
      title: 'Find files',
      prompt: 'Find all files',
      agentType: 'Explore',
      status: 'done',
      endedAt: 6,
      toolCount: 1,
      errorCount: 1,
    })
    // SubagentStop is logged by the parent, so it shows in the prompt's log.
    expect(prompt.events.map((e) => e.hookName)).toContain('SubagentStop')
    expect(child.events.map((e) => e.hookName)).toEqual([
      'SubagentStart',
      'PreToolUse',
      'PostToolUseFailure',
    ])
  })

  test('attaches a still-running subagent to the prompt open when it started', () => {
    const A = 'agent-live'
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'go' }),
      ev('PreToolUse', 2, { prompt_id: 'p1', tool_name: 'Agent', tool_use_id: 'ta' }),
      ev('SubagentStart', 3, { agent_id: A, agent_type: 'general-purpose' }, A),
      ev('PreToolUse', 4, { tool_name: 'Bash', tool_use_id: 'b1' }, A),
    ])
    expect(roots[0].children.map((c) => c.id)).toEqual([A])
    expect(roots[0].children[0]).toMatchObject({ status: 'running', title: 'general-purpose' })
    expect(roots[0].status).toBe('running')
  })

  test('nests a subagent under the subagent that spawned it', () => {
    const A = 'agent-a'
    const B = 'agent-b'
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'go' }),
      ev('SubagentStart', 2, { agent_id: A }, A),
      ev('SubagentStart', 3, { agent_id: B }, B),
      ev(
        'PostToolUse',
        4,
        { tool_name: 'Agent', tool_use_id: 'tb', tool_response: { agentId: B } },
        A,
      ),
      ev('PostToolUse', 5, {
        prompt_id: 'p1',
        tool_name: 'Agent',
        tool_use_id: 'ta',
        tool_response: { agentId: A },
      }),
    ])
    const a = roots[0].children[0]
    expect(a.id).toBe(A)
    expect(a.children.map((c) => c.id)).toEqual([B])
  })

  test('internal SubagentStops without agent events do not create nodes', () => {
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'fetch' }),
      ev('SubagentStop', 2, { prompt_id: 'p1', agent_id: 'internal', agent_type: '' }),
      ev('Stop', 3, { prompt_id: 'p1' }),
    ])
    expect(roots[0].children).toEqual([])
    expect(roots[0].events.map((e) => e.hookName)).toContain('SubagentStop')
  })

  test('status: waiting on a trailing Notification, interrupted when a later prompt starts', () => {
    const waiting = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('Notification', 2, { prompt_id: 'p1' }),
    ])
    expect(waiting[0].status).toBe('waiting')

    const interrupted = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('PreToolUse', 2, { prompt_id: 'p1', tool_name: 'Bash' }),
      ev('UserPromptSubmit', 3, { prompt_id: 'p2', prompt: 'b' }),
    ])
    expect(interrupted[0]).toMatchObject({ status: 'interrupted', endedAt: 2 })
    expect(interrupted[1].status).toBe('running')

    const failed = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('StopFailure', 2, { prompt_id: 'p1' }),
    ])
    expect(failed[0].status).toBe('failed')
  })

  test('background-lane events count as the main agent', () => {
    const roots = build([
      ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'a' }),
      ev('PostToolUse', 2, { prompt_id: 'p1', tool_name: 'Bash' }, `${S}:background`),
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].children).toEqual([])
    expect(roots[0].events).toHaveLength(2)
  })

  test('is order-independent', () => {
    const events = [
      ev('SessionStart', 1),
      ev('UserPromptSubmit', 2, { prompt_id: 'p1', prompt: 'a' }),
      ev('Stop', 3, { prompt_id: 'p1' }),
    ]
    const a = build(events)
    const b = build([...events].reverse())
    expect(b.map((n) => [n.id, n.events.length])).toEqual(a.map((n) => [n.id, n.events.length]))
  })
})

describe('task-notification merging', () => {
  const A = 'agent-bg'
  const note = (taskId: string, toolUseId: string, status = 'completed') =>
    [
      '<task-notification>',
      `<task-id>${taskId}</task-id>`,
      `<tool-use-id>${toolUseId}</tool-use-id>`,
      `<status>${status}</status>`,
      `<summary>Agent "Research" finished</summary>`,
      '<result>## Findings\nAll good.</result>',
      '<usage><subagent_tokens>1200</subagent_tokens><tool_uses>7</tool_uses><duration_ms>65000</duration_ms></usage>',
      '</task-notification>',
    ].join('\n')

  // Prompt p1 launches a background subagent, stops, then the notification
  // turn (its own prompt_id n1) wraps up.
  const events = () => [
    ev('UserPromptSubmit', 1, { prompt_id: 'p1', prompt: 'research loops' }),
    ev('PreToolUse', 2, {
      prompt_id: 'p1',
      tool_name: 'Agent',
      tool_use_id: 'toolu_1',
      tool_input: { description: 'Research', run_in_background: true },
    }),
    ev('PostToolUse', 3, {
      prompt_id: 'p1',
      tool_name: 'Agent',
      tool_use_id: 'toolu_1',
      tool_response: { agentId: A, isAsync: true },
    }),
    ev('SubagentStart', 3, { agent_id: A }, A),
    ev('Stop', 4, { prompt_id: 'p1', last_assistant_message: 'Waiting for the agent.' }),
    ev('PreToolUse', 5, { prompt_id: 'p1', tool_name: 'WebSearch', tool_use_id: 's1' }, A),
  ]

  test('parses the notification message', () => {
    expect(parseTaskNotification(note(A, 'toolu_1'))).toMatchObject({
      taskId: A,
      toolUseId: 'toolu_1',
      status: 'completed',
      summary: 'Agent "Research" finished',
      result: '## Findings\nAll good.',
      usage: { tokens: 1200, toolUses: 7, durationMs: 65000 },
    })
    expect(parseTaskNotification('just a prompt')).toBeNull()
  })

  test('while the subagent runs, the prompt is "background", not done', () => {
    const [p1] = build(events())
    expect(p1).toMatchObject({ status: 'background', endedAt: null })
    expect(p1.children[0]).toMatchObject({ id: A, status: 'running', result: null })
  })

  test('the notification turn merges into the origin prompt and fills the result', () => {
    const roots = build([
      ...events(),
      ev('UserPromptSubmit', 10, { prompt_id: 'n1', prompt: note(A, 'toolu_1') }),
      ev('PreToolUse', 11, { prompt_id: 'n1', tool_name: 'Write', tool_use_id: 'w1' }),
      ev('Stop', 12, { prompt_id: 'n1', last_assistant_message: 'Summary written.' }),
    ])
    expect(roots.map((n) => n.id)).toEqual(['p1']) // no separate "prompt" for n1
    const [p1] = roots
    expect(p1).toMatchObject({ status: 'done', endedAt: 12, promptIds: ['p1', 'n1'] })
    expect(p1.toolCount).toBe(2) // Agent + Write; the subagent's WebSearch counts for the subagent
    const sub = p1.children[0]
    expect(sub).toMatchObject({
      status: 'done',
      endedAt: 10,
      result: '## Findings\nAll good.',
      usage: { tokens: 1200, toolUses: 7, durationMs: 65000 },
    })
  })

  test('a failed task marks the subagent failed', () => {
    const [p1] = build([
      ...events(),
      ev('UserPromptSubmit', 10, { prompt_id: 'n1', prompt: note(A, 'toolu_1', 'failed') }),
    ])
    expect(p1.children[0].status).toBe('failed')
  })
})
