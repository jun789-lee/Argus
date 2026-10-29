import { describe, expect, test } from 'vitest'
import { buildItems } from './conversation-view'
import type { TurnNode } from '@/lib/turn-tree'
import type { EnrichedEvent } from '@/agents/types'

function enriched(id: number, hookName: string, timestamp: number, toolName: string | null = null) {
  return { id, hookName, timestamp, toolName, displayEventStream: true } as EnrichedEvent
}

const node = (eventIds: number[]) =>
  ({ events: eventIds.map((id) => ({ id })) }) as unknown as TurnNode

describe('buildItems', () => {
  const events = [
    enriched(1, 'UserPromptSubmit', 1),
    enriched(2, 'PreToolUse', 3, 'Read'),
    enriched(3, 'PreToolUse', 4, 'Edit'),
    enriched(4, 'PreToolUse', 7, 'Bash'),
    enriched(5, 'Stop', 9),
    enriched(99, 'PreToolUse', 5, 'Read'), // another node's event
  ]

  test('interleaves replies with grouped events, hiding Input/Output hooks', () => {
    const items = buildItems(
      node([1, 2, 3, 4, 5]),
      events,
      [
        { timestamp: 2, text: 'Looking first.' },
        { timestamp: 6, text: 'Now running tests.' },
        { timestamp: 8, text: 'All done!' },
      ],
      'All done!',
    )
    expect(
      items.map((i) => (i.kind === 'text' ? i.text : i.events.map((e) => e.toolName).join('+'))),
    ).toEqual(['Looking first.', 'Read+Edit', 'Now running tests.', 'Bash'])
  })

  test('works without transcript replies', () => {
    const items = buildItems(node([1, 2, 3, 5]), events, [], null)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('activity')
  })
})
