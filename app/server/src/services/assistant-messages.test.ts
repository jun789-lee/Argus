import { describe, test, expect } from 'vitest'
import { extractAssistantMessages } from './assistant-messages'

const user = (promptId: string) =>
  JSON.stringify({ type: 'user', promptId, message: { content: 'x' } })
const asst = (
  ts: string,
  blocks: Array<{ type: string; text?: string }>,
  extra: Record<string, unknown> = {},
) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: blocks }, ...extra })

describe('extractAssistantMessages', () => {
  const lines = [
    user('p1'),
    asst('2026-01-01T00:00:01Z', [{ type: 'thinking', text: 'hmm' }], { requestId: 'r1' }),
    asst('2026-01-01T00:00:02Z', [{ type: 'text', text: 'Checking first.' }], { requestId: 'r1' }),
    asst('2026-01-01T00:00:03Z', [{ type: 'tool_use' }], { requestId: 'r1' }),
    user('p1'), // tool_result entry — same prompt
    asst('2026-01-01T00:00:05Z', [{ type: 'text', text: 'Done.' }], { requestId: 'r2' }),
    asst('2026-01-01T00:00:06Z', [{ type: 'text', text: 'Also this.' }], { requestId: 'r2' }),
    user('p2'),
    asst('2026-01-01T00:00:09Z', [{ type: 'text', text: 'Second prompt reply' }], {
      requestId: 'r3',
    }),
    asst('2026-01-01T00:00:10Z', [{ type: 'text', text: 'subagent noise' }], { isSidechain: true }),
    'not json',
  ]

  test('attributes replies to their prompt and merges blocks of one response', () => {
    expect(extractAssistantMessages(lines, { promptId: 'p1' })).toEqual([
      { timestamp: Date.parse('2026-01-01T00:00:02Z'), text: 'Checking first.' },
      { timestamp: Date.parse('2026-01-01T00:00:05Z'), text: 'Done.\n\nAlso this.' },
    ])
    expect(extractAssistantMessages(lines, { promptId: 'p2' }).map((m) => m.text)).toEqual([
      'Second prompt reply',
    ])
  })

  test('skips sidechain entries unless asked (subagent transcripts)', () => {
    const all = extractAssistantMessages(lines).map((m) => m.text)
    expect(all).not.toContain('subagent noise')
    expect(
      extractAssistantMessages(lines, { includeSidechain: true }).map((m) => m.text),
    ).toContain('subagent noise')
  })
})
