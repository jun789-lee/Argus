import { describe, expect, test } from 'vitest'
import { buildPlan } from './plan'
import type { TreeEvent, TurnNode } from './turn-tree'

let id = 1
const ev = (
  hookName: string,
  timestamp: number,
  payload: Record<string, unknown> = {},
): TreeEvent => ({
  id: id++,
  agentId: 's',
  hookName,
  timestamp,
  payload,
})

function prompt(
  events: TreeEvent[],
  children: TurnNode[] = [],
  endedAt: number | null = 100,
): TurnNode {
  return {
    id: 'p',
    kind: 'prompt',
    agentId: 's',
    title: 'p',
    prompt: 'p',
    agentType: null,
    events,
    children,
    startedAt: 0,
    endedAt,
    lastEventAt: 0,
    status: endedAt === null ? 'running' : 'done',
    toolCount: 0,
    errorCount: 0,
  }
}

const sub = (startedAt: number): TurnNode => ({
  ...prompt([]),
  id: `sub-${startedAt}`,
  kind: 'subagent',
  startedAt,
})

const create = (ts: number, taskId: string, subject: string) => [
  ev('TaskCreated', ts, { task_id: taskId, task_subject: subject }),
  ev('PostToolUse', ts, {
    tool_name: 'TaskCreate',
    tool_input: { subject, activeForm: `${subject}ing` },
    tool_response: { task: { id: taskId } },
  }),
]
const update = (ts: number, taskId: string, status: string) =>
  ev('PostToolUse', ts, { tool_name: 'TaskUpdate', tool_input: { taskId, status } })
const tool = (ts: number, name = 'Bash', fail = false) => [
  ev('PreToolUse', ts, { tool_name: name, tool_use_id: `t${ts}` }),
  ...(fail ? [ev('PostToolUseFailure', ts + 1, { tool_name: name, tool_use_id: `t${ts}` })] : []),
]

describe('buildPlan', () => {
  test('task list: steps, statuses, per-step tools and subagents, progress', () => {
    const plan = buildPlan(
      prompt(
        [
          ...create(1, '1', 'Read code'),
          ...create(2, '2', 'Write tests'),
          ...create(3, '3', 'Ship'),
          update(4, '1', 'in_progress'),
          ...tool(5, 'Read'),
          ...tool(6, 'Grep'),
          update(10, '1', 'completed'),
          update(11, '2', 'in_progress'),
          ...tool(12, 'Bash', true),
        ],
        [sub(7), sub(13)],
        null,
      ),
    )
    expect(plan.source).toBe('tasks')
    expect(plan.steps.map((s) => [s.title, s.status])).toEqual([
      ['Read code', 'completed'],
      ['Write tests', 'in_progress'],
      ['Ship', 'pending'],
    ])
    expect(plan.steps[0]).toMatchObject({ toolCount: 2, startedAt: 4, endedAt: 10 })
    expect(plan.steps[0].subagents.map((s) => s.id)).toEqual(['sub-7'])
    expect(plan.steps[1]).toMatchObject({
      toolCount: 1,
      errorCount: 1,
      activeForm: 'Write testsing',
    })
    expect(plan.steps[1].subagents.map((s) => s.id)).toEqual(['sub-13'])
    expect(plan).toMatchObject({ completed: 1, total: 3 })
    expect(plan.progress).toBeCloseTo(1 / 3)
  })

  test('task tool calls are not counted as work, and stray work is unassigned', () => {
    const plan = buildPlan(
      prompt([...tool(0), ...create(1, '1', 'Only step'), update(2, '1', 'completed')]),
    )
    expect(plan.steps[0].toolCount).toBe(0)
    expect(plan.unassigned.toolCount).toBe(1)
  })

  test('deleted tasks disappear', () => {
    const plan = buildPlan(
      prompt([...create(1, '1', 'a'), ...create(2, '2', 'b'), update(3, '2', 'deleted')]),
    )
    expect(plan.steps.map((s) => s.title)).toEqual(['a'])
  })

  test('legacy TodoWrite: last snapshot wins, timings from transitions', () => {
    const todo = (ts: number, items: Array<[string, string]>) =>
      ev('PreToolUse', ts, {
        tool_name: 'TodoWrite',
        tool_input: { todos: items.map(([content, status]) => ({ content, status })) },
      })
    const plan = buildPlan(
      prompt([
        todo(1, [
          ['A', 'in_progress'],
          ['B', 'pending'],
          ['C', 'pending'],
        ]),
        ...tool(2),
        todo(3, [
          ['A', 'completed'],
          ['B', 'in_progress'],
        ]), // C dropped
      ]),
    )
    expect(plan.source).toBe('todos')
    expect(plan.steps.map((s) => [s.title, s.status])).toEqual([
      ['A', 'completed'],
      ['B', 'in_progress'],
    ])
    expect(plan.steps[0]).toMatchObject({ startedAt: 1, endedAt: 3, toolCount: 1 })
    expect(plan.progress).toBe(0.5)
  })

  test('falls back to replies as steps without a known total', () => {
    const plan = buildPlan(prompt([...tool(2), ...tool(6)], [], null), [
      { timestamp: 1, text: '## First I will **look**\nmore' },
      { timestamp: 5, text: 'Now testing' },
    ])
    expect(plan.source).toBe('replies')
    expect(plan.steps.map((s) => [s.title, s.status, s.toolCount])).toEqual([
      ['First I will look', 'completed', 1],
      ['Now testing', 'in_progress', 1],
    ])
    expect(plan.progress).toBeNull()
  })

  test('none when there is nothing to build from', () => {
    expect(buildPlan(prompt([])).source).toBe('none')
  })
})
