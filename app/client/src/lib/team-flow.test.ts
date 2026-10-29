import { describe, expect, test } from 'vitest'
import { buildMissionFlow, buildMissions, roleOf } from './team-flow'
import type { TurnNode } from './turn-tree'

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

describe('roleOf', () => {
  test('maps known types and keeps custom names', () => {
    expect(roleOf('Explore')).toEqual({ label: 'Researcher', icon: '🔍' })
    expect(roleOf('loop-runner')).toEqual({ label: 'loop-runner', icon: '🤖' })
    expect(roleOf(null).label).toBe('Subagent')
  })
})

describe('buildMissions', () => {
  test('one card per prompt with member counts', () => {
    const sub = node({ id: 'a', kind: 'subagent', children: [node({ id: 'b', kind: 'subagent' })] })
    const cards = buildMissions([
      node({ id: 'sys', kind: 'system' }),
      node({ id: 'p1', status: 'done', children: [sub] }),
      node({ id: 'p2' }),
    ])
    expect(cards.map((c) => [c.node.id, c.members])).toEqual([
      ['p1', 2],
      ['p2', 0],
    ])
  })
})

describe('buildMissionFlow', () => {
  const research = node({
    id: 'r',
    kind: 'subagent',
    agentType: 'Explore',
    title: 'Find loop papers',
    startedAt: 10,
    endedAt: 50,
    status: 'done',
    result: '## Findings\n\n**60 sources** found across five questions.',
  })
  const verify = node({
    id: 'v',
    kind: 'subagent',
    agentType: 'general-purpose',
    title: 'Check claims',
    startedAt: 12,
  })
  const mission = node({ id: 'p', children: [research, verify] })

  test('members carry role, task, and a one-line report', () => {
    const flow = buildMissionFlow(mission, [], null)
    expect(flow.members.map((m) => [m.role.label, m.task, m.report, m.depth])).toEqual([
      ['Researcher', 'Find loop papers', '60 sources found across five questions.', 1],
      ['Generalist', 'Check claims', null, 1],
    ])
  })

  test('decisions are manager replies after the first report, excluding the final answer', () => {
    const flow = buildMissionFlow(
      mission,
      [
        { timestamp: 5, text: 'Sending two agents out.' }, // before any report → delegation, not a decision
        { timestamp: 55, text: 'Research is in; dropping option B.' },
        { timestamp: 90, text: 'Final report written.' },
      ],
      'Final report written.',
    )
    expect(flow.decisions.map((d) => d.summary)).toEqual(['Research is in; dropping option B.'])
    expect(flow.output).toBe('Final report written.')
  })

  test('a mission without a team shows the manager notes', () => {
    const flow = buildMissionFlow(
      node({ id: 'solo' }),
      [{ timestamp: 1, text: 'Reading files.' }],
      null,
    )
    expect(flow.members).toEqual([])
    expect(flow.decisions.map((d) => d.summary)).toEqual(['Reading files.'])
  })
})
