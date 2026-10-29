import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import type { WSClientMessage } from './types'

// Multi-session subscriptions. The pure tests pin down how subscribe
// messages map to a session set; the integration tests open real sockets
// and check that a broadcast for one session never reaches a client that
// didn't ask for it — the cross-talk a side-by-side compare view would
// otherwise show. config is mocked so auto-shutdown stays disabled.

vi.mock('./config', () => ({
  config: { logLevel: 'warn', shutdownDelayMs: 0, corsAllowedOrigins: [] },
}))

const { attachWebSocket, broadcastToSession, subscriptionFromMessage, MAX_SUBSCRIBED_SESSIONS } =
  await import('./websocket')

describe('subscriptionFromMessage', () => {
  test('single-session form subscribes to just that session', () => {
    expect(subscriptionFromMessage({ type: 'subscribe', sessionId: 'a' })).toEqual(new Set(['a']))
  })

  test('list form subscribes to every listed session, deduped', () => {
    expect(subscriptionFromMessage({ type: 'subscribe', sessionIds: ['a', 'b', 'a'] })).toEqual(
      new Set(['a', 'b']),
    )
  })

  test('drops non-string and empty ids', () => {
    const msg = { type: 'subscribe', sessionIds: ['a', '', 42, null] } as unknown as WSClientMessage
    expect(subscriptionFromMessage(msg)).toEqual(new Set(['a']))
  })

  test('caps the number of sessions per client', () => {
    const ids = Array.from({ length: MAX_SUBSCRIBED_SESSIONS + 5 }, (_, i) => `s${i}`)
    expect(subscriptionFromMessage({ type: 'subscribe', sessionIds: ids })!.size).toBe(
      MAX_SUBSCRIBED_SESSIONS,
    )
  })

  test('empty list and unsubscribe both clear the subscription', () => {
    expect(subscriptionFromMessage({ type: 'subscribe', sessionIds: [] })).toEqual(new Set())
    expect(subscriptionFromMessage({ type: 'unsubscribe' })).toEqual(new Set())
  })

  test('a subscribe with no session is ignored', () => {
    const msg = { type: 'subscribe' } as unknown as WSClientMessage
    expect(subscriptionFromMessage(msg)).toBeNull()
  })
})

interface TestClient {
  ws: WebSocket
  received: Array<{ type: string; data: { sessionId: string } }>
  send: (msg: WSClientMessage) => void
}

// No ack exists for subscribe, so give the server a beat to process
// messages (and deliver broadcasts) before asserting.
const settle = () => new Promise((r) => setTimeout(r, 50))

describe('broadcastToSession routing', () => {
  let server: Server
  const clients: TestClient[] = []

  beforeAll(async () => {
    server = createServer()
    attachWebSocket(server)
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  })

  afterAll(() => {
    for (const c of clients) c.ws.close()
    server.close()
  })

  async function connect(): Promise<TestClient> {
    const { port } = server.address() as AddressInfo
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events/stream`)
    const client: TestClient = {
      ws,
      received: [],
      send: (msg) => ws.send(JSON.stringify(msg)),
    }
    ws.on('message', (raw) => client.received.push(JSON.parse(raw.toString())))
    await new Promise((res) => ws.on('open', res))
    clients.push(client)
    return client
  }

  function emit(sessionId: string) {
    broadcastToSession(sessionId, { type: 'event', data: { sessionId } })
  }

  const sessionsReceived = (c: TestClient) => c.received.map((m) => m.data.sessionId)

  test('a client watching two sessions gets both and nothing else', async () => {
    const c = await connect()
    c.send({ type: 'subscribe', sessionIds: ['A', 'B'] })
    await settle()
    emit('A')
    emit('B')
    emit('C')
    await settle()
    expect(sessionsReceived(c)).toEqual(['A', 'B'])
  })

  test('two clients on different sessions never see each other’s events', async () => {
    const left = await connect()
    const right = await connect()
    left.send({ type: 'subscribe', sessionIds: ['L'] })
    right.send({ type: 'subscribe', sessionIds: ['R'] })
    await settle()
    emit('L')
    emit('R')
    emit('L')
    await settle()
    expect(sessionsReceived(left)).toEqual(['L', 'L'])
    expect(sessionsReceived(right)).toEqual(['R'])
  })

  test('resubscribing replaces the old set instead of adding to it', async () => {
    const c = await connect()
    c.send({ type: 'subscribe', sessionIds: ['X', 'Y'] })
    c.send({ type: 'subscribe', sessionIds: ['Y'] })
    await settle()
    emit('X')
    emit('Y')
    await settle()
    expect(sessionsReceived(c)).toEqual(['Y'])
  })

  test('the original single-session message still works', async () => {
    const c = await connect()
    c.send({ type: 'subscribe', sessionId: 'S' })
    await settle()
    emit('S')
    emit('T')
    await settle()
    expect(sessionsReceived(c)).toEqual(['S'])
  })

  test('unsubscribe stops all session events', async () => {
    const c = await connect()
    c.send({ type: 'subscribe', sessionIds: ['U', 'V'] })
    c.send({ type: 'unsubscribe' })
    await settle()
    emit('U')
    emit('V')
    await settle()
    expect(sessionsReceived(c)).toEqual([])
  })
})
