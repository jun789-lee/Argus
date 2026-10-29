import { describe, test, expect } from 'vitest'
import { detectToolAvailability } from './tool-availability'

const shape = (names: string[]) =>
  JSON.stringify({ type: 'api-request-shape', shape: { tools: names.map((name) => ({ name })) } })
const deferred = (names: string[]) =>
  JSON.stringify({
    type: 'attachment',
    attachment: {
      content: `<system-reminder>\nThe following deferred tools are now available via ToolSearch. Use ToolSearch:\n${names.join('\n')}\n</system-reminder>`,
    },
  })

describe('detectToolAvailability', () => {
  test('null when the transcript has no tool information', () => {
    expect(detectToolAvailability(['{"type":"user"}', ''])).toEqual({ todoTools: null, found: [] })
  })

  test('missing to-do tools (the default on newer models)', () => {
    expect(
      detectToolAvailability([
        shape(['Agent', 'Bash', 'Read']),
        deferred(['EnterPlanMode', 'TaskStop']),
      ]),
    ).toEqual({
      todoTools: false,
      found: [],
    })
  })

  test('available when loaded in the request', () => {
    expect(detectToolAvailability([shape(['Bash', 'TaskCreate', 'TaskUpdate'])]).todoTools).toBe(
      true,
    )
  })

  test('available when only listed as a deferred tool', () => {
    expect(detectToolAvailability([shape(['Bash']), deferred(['TaskCreate', 'TaskGet'])])).toEqual({
      todoTools: true,
      found: ['TaskCreate'],
    })
  })

  test('the newest shape wins (tools turned on mid-session)', () => {
    const lines = [shape(['Bash']), '{"type":"user"}', shape(['Bash', 'TodoWrite'])]
    expect(detectToolAvailability(lines)).toEqual({ todoTools: true, found: ['TodoWrite'] })
  })
})
