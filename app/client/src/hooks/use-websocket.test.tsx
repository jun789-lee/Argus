import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ParsedEvent } from '@/types'

vi.mock('@/lib/server-health', () => ({ getServerHealth: () => Promise.resolve(null) }))
vi.mock('@/stores/filter-store', () => ({
  useFilterStore: { getState: () => ({ load: () => Promise.resolve() }) },
}))

const { useWebSocket, subscriptionKey, resolveEventSessionId, groupEventsBySession } =
  await import('./use-websocket')

function ev(id: number, sessionId: string): ParsedEvent {
  return {
    id,
    sessionId,
    agentId: 'agent',
    hookName: 'PreToolUse',
    timestamp: id,
    payload: {},
    cwd: null,
    _meta: null,
  } as ParsedEvent
}

describe('subscriptionKey', () => {
  it('ignores order and duplicates', () => {
    expect(subscriptionKey(['b', 'a', 'b'])).toBe(subscriptionKey(['a', 'b']))
  })

  it('is empty for no sessions', () => {
    expect(subscriptionKey([])).toBe('')
  })
})

describe('resolveEventSessionId', () => {
  it('keeps a tagged event for a subscribed session', () => {
    expect(resolveEventSessionId('a', new Set(['a', 'b']))).toBe('a')
  })

  it('drops a tagged event for a session that is not subscribed', () => {
    expect(resolveEventSessionId('c', new Set(['a', 'b']))).toBeNull()
  })

  it('falls back to the only subscribed session for an untagged event', () => {
    expect(resolveEventSessionId(undefined, new Set(['a']))).toBe('a')
  })

  it('drops an untagged event when two sessions are subscribed', () => {
    expect(resolveEventSessionId(undefined, new Set(['a', 'b']))).toBeNull()
  })
})

describe('groupEventsBySession', () => {
  it('splits interleaved events per session, keeping order', () => {
    const groups = groupEventsBySession(
      [ev(1, 'a'), ev(2, 'b'), ev(3, 'a'), ev(4, 'b')],
      new Set(['a', 'b']),
    )
    expect(groups.get('a')!.map((e) => e.id)).toEqual([1, 3])
    expect(groups.get('b')!.map((e) => e.id)).toEqual([2, 4])
  })

  it('skips sessions that are no longer subscribed', () => {
    const groups = groupEventsBySession([ev(1, 'a'), ev(2, 'gone')], new Set(['a']))
    expect([...groups.keys()]).toEqual(['a'])
  })
})

// Minimal stand-in for the browser WebSocket: records what the hook sends
// and lets the test push server messages in.
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  serverSends(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

function Probe({ sessionIds }: { sessionIds: string[] }) {
  useWebSocket(sessionIds)
  return null
}

describe('useWebSocket with two sessions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    queryClient = new QueryClient()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mount(sessionIds: string[]) {
    const ui = (ids: string[]) => (
      <QueryClientProvider client={queryClient}>
        <Probe sessionIds={ids} />
      </QueryClientProvider>
    )
    const view = render(ui(sessionIds))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.open())
    return { ws, rerender: (ids: string[]) => view.rerender(ui(ids)) }
  }

  const cached = (sessionId: string) =>
    (queryClient.getQueryData<ParsedEvent[]>(['events', sessionId]) ?? []).map((e) => e.id)

  it('subscribes to both sessions in one message', () => {
    const { ws } = mount(['A', 'B'])
    expect(ws.sent).toContainEqual({ type: 'subscribe', sessionIds: ['A', 'B'] })
  })

  it('files interleaved events under their own session only', () => {
    const { ws } = mount(['A', 'B'])
    act(() => {
      ws.serverSends({ type: 'event', data: ev(1, 'A') })
      ws.serverSends({ type: 'event', data: ev(2, 'B') })
      ws.serverSends({ type: 'event', data: ev(3, 'A') })
      ws.serverSends({ type: 'event', data: ev(4, 'C') })
      vi.advanceTimersByTime(200)
    })
    expect(cached('A')).toEqual([1, 3])
    expect(cached('B')).toEqual([2])
    expect(cached('C')).toEqual([])
  })

  it('dropping one session keeps the other’s buffered events', () => {
    const { ws, rerender } = mount(['A', 'B'])
    act(() => {
      ws.serverSends({ type: 'event', data: ev(1, 'A') })
      ws.serverSends({ type: 'event', data: ev(2, 'B') })
    })
    // Unsubscribe B before the buffer flushes.
    act(() => rerender(['A']))
    act(() => vi.advanceTimersByTime(200))
    expect(cached('A')).toEqual([1])
    expect(cached('B')).toEqual([])
    expect(ws.sent.at(-1)).toEqual({ type: 'subscribe', sessionIds: ['A'] })
  })

  it('does not resend when the same sessions arrive in a new array', () => {
    const { ws, rerender } = mount(['A', 'B'])
    const before = ws.sent.length
    act(() => rerender(['B', 'A']))
    expect(ws.sent.length).toBe(before)
  })
})
