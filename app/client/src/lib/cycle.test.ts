import { describe, expect, test } from 'vitest'
import { cycleFromMission, isEvalEvent } from './cycle'
import { buildPlan } from './plan'
import { buildMissionFlow } from './team-flow'
import type { TreeEvent, TurnNode } from './turn-tree'

let nextId = 1
const ev = (
  hookName: string,
  timestamp: number,
  payload: Record<string, unknown> = {},
): TreeEvent => ({
  id: nextId++,
  agentId: 's',
  hookName,
  timestamp,
  payload,
})
const bash = (ts: number, command: string, id = `b${ts}`) =>
  ev('PreToolUse', ts, { tool_name: 'Bash', tool_use_id: id, tool_input: { command } })

function node(p: Partial<TurnNode> & Pick<TurnNode, 'id'>): TurnNode {
  return {
    kind: 'prompt',
    agentId: 's',
    title: p.id,
    prompt: null,
    agentType: null,
    events: [],
    children: [],
    startedAt: 0,
    endedAt: null,
    lastEventAt: 0,
    status: 'running',
    toolCount: 0,
    errorCount: 0,
    result: null,
    usage: null,
    promptIds: [p.id],
    ...p,
  }
}

function cycle(
  mission: TurnNode,
  replies: Array<{ timestamp: number; text: string }> = [],
  output: string | null = null,
) {
  return cycleFromMission(mission, buildMissionFlow(mission, replies, output), buildPlan(mission))
}

describe('isEvalEvent', () => {
  test('recognises test / build / type-check commands', () => {
    expect(isEvalEvent(bash(1, 'npx vitest run'))).toBe(true)
    expect(isEvalEvent(bash(1, 'npm run build'))).toBe(true)
    expect(isEvalEvent(bash(1, 'npx tsc -b'))).toBe(true)
    expect(isEvalEvent(bash(1, 'git status'))).toBe(false)
  })
})

describe('cycleFromMission', () => {
  test('a finished mission with a team, checks, and an answer', () => {
    const research = node({
      id: 'r',
      kind: 'subagent',
      agentType: 'Explore',
      title: 'Find papers',
      startedAt: 5,
      endedAt: 20,
      status: 'done',
      result: 'Found 12 papers.',
    })
    const failed = bash(30, 'npm test', 't1')
    const mission = node({
      id: 'p',
      status: 'done',
      endedAt: 60,
      children: [research],
      events: [
        ev('PreToolUse', 2, { tool_name: 'Agent', tool_use_id: 'a' }),
        ev('PreToolUse', 25, { tool_name: 'Edit', tool_use_id: 'e' }),
        failed,
        ev('PostToolUseFailure', 31, { tool_name: 'Bash', tool_use_id: 't1' }),
        bash(40, 'npm test', 't2'),
      ],
    })
    const c = cycle(
      mission,
      [{ timestamp: 45, text: 'Tests pass now; shipping.' }],
      'Done: fixed and tested.',
    )
    expect(c.current).toBeNull()
    expect(c.stages.plan.status).toBe('skipped') // no task list
    expect(c.stages.execute.status).toBe('done')
    expect(c.stages.execute.items.map((i) => i.label)).toEqual(['Find papers', '1']) // member + 1 Edit
    expect(c.stages.evaluate).toMatchObject({ status: 'done', estimated: true })
    expect(c.stages.evaluate.items.map((i) => i.state)).toEqual(['failed', 'done'])
    expect(c.stages.decide.status).toBe('done')
    expect(c.stages.decide.items.map((i) => i.icon)).toEqual(['💡', '📦'])
    expect(c.team.map((r) => r.icon)).toEqual(['🔍'])
    expect(c).toMatchObject({ lap: 1, laps: 1 })
  })

  test('current stage follows the latest signal while running', () => {
    expect(cycle(node({ id: 'p' })).current).toBe('plan')
    expect(
      cycle(node({ id: 'p', events: [ev('PreToolUse', 1, { tool_name: 'Read' })] })).current,
    ).toBe('execute')
    expect(
      cycle(
        node({ id: 'p', events: [ev('PreToolUse', 1, { tool_name: 'Read' }), bash(2, 'pytest')] }),
      ).current,
    ).toBe('evaluate')
    const busy = node({ id: 'p', children: [node({ id: 's1', kind: 'subagent', startedAt: 1 })] })
    expect(cycle(busy).current).toBe('execute')
  })

  test('stages before the current one without activity are skipped, later ones idle', () => {
    const c = cycle(node({ id: 'p', events: [ev('PreToolUse', 1, { tool_name: 'Read' })] }))
    expect(c.stages.plan.status).toBe('skipped')
    expect(c.stages.execute.status).toBe('active')
    expect(c.stages.evaluate.status).toBe('idle')
    expect(c.stages.decide.status).toBe('idle')
  })
})
