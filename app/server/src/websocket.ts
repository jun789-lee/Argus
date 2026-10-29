import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSClientMessage } from './types'
import { config } from './config'
import { isWsOriginAllowed } from './cors'
import { checkShutdown, cancelPendingShutdown } from './consumer-tracker'

const LOG_LEVEL = config.logLevel

// Track which sessions each client is subscribed to. A client can watch
// several sessions at once (e.g. a side-by-side compare view), so each
// entry is a set; clients with nothing subscribed have no entry.
const clientSessions = new Map<WebSocket, Set<string>>()
const allClients = new Set<WebSocket>()

/** Cap on sessions per client so a buggy or hostile client can't make
 *  every broadcast scan an unbounded set. */
export const MAX_SUBSCRIBED_SESSIONS = 20

/** Pure: the full set of session ids a client should receive after this
 *  message, or `null` when the message doesn't change subscriptions.
 *  Subscriptions are declarative — each subscribe replaces the whole set,
 *  so a dropped message can't leave client and server out of sync.
 *  `{ sessionId }` (the original single-session form) means "just this one". */
export function subscriptionFromMessage(msg: WSClientMessage): Set<string> | null {
  if (msg.type === 'unsubscribe') return new Set()
  if (msg.type !== 'subscribe') return null
  if ('sessionIds' in msg && Array.isArray(msg.sessionIds)) {
    const ids = msg.sessionIds.filter((id): id is string => typeof id === 'string' && id !== '')
    return new Set(ids.slice(0, MAX_SUBSCRIBED_SESSIONS))
  }
  if ('sessionId' in msg && typeof msg.sessionId === 'string' && msg.sessionId !== '') {
    return new Set([msg.sessionId])
  }
  return null
}

function describeSessions(ids: Set<string> | undefined): string {
  if (!ids || ids.size === 0) return 'none'
  return [...ids].map((id) => id.slice(0, 8)).join(', ')
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/api/events/stream',
    // Reject cross-origin browser connections. The event stream is
    // unauthenticated, so without this a page the user visits could open
    // ws://localhost and read the feed (CORS doesn't gate WebSockets). Uses
    // the same allowlist as HTTP CORS (AGENTS_OBSERVE_CORS_ORIGINS). See
    // GitHub issue #22.
    verifyClient: (info) => {
      const allowed = isWsOriginAllowed(info.origin, config.corsAllowedOrigins ?? [])
      if (!allowed) {
        console.warn(`[WS] Rejected connection from disallowed origin: ${info.origin}`)
      }
      return allowed
    },
  })

  wss.on('connection', (ws) => {
    allClients.add(ws)
    cancelPendingShutdown()
    console.log(`[WS] Client connected (${allClients.size} total)`)

    ws.on('message', (raw) => {
      try {
        const msg: WSClientMessage = JSON.parse(raw.toString())
        const next = subscriptionFromMessage(msg)
        if (next) {
          const prev = clientSessions.get(ws)
          if (next.size > 0) clientSessions.set(ws, next)
          else clientSessions.delete(ws)
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            console.log(
              `[WS] Client subscribed to sessions [${describeSessions(next)}] (was: [${describeSessions(prev)}])`,
            )
          }
        }
      } catch {}
    })

    ws.on('close', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
      console.log(`[WS] Client disconnected (${allClients.size} remaining)`)
      checkShutdown()
    })

    ws.on('error', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

/** Send a message only to clients subscribed to a specific session */
export function broadcastToSession(sessionId: string, message: object): void {
  const json = JSON.stringify(message)
  for (const [client, subscribed] of clientSessions) {
    if (subscribed.has(sessionId) && client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

// Activity pings tell every connected client that a given session just
// received an event, so the sidebar can animate a pulse. Throttle to
// once per session per ACTIVITY_PING_THROTTLE_MS so a busy session
// doesn't flood the wire with hundreds of pings/second × all clients.
// The map is process-global (not per-connection): slightly less
// responsive on cold-start but trivially small memory and simple to
// reason about. See docs/superpowers/specs/2026-04-24-session-activity-pings-design.md.
export const ACTIVITY_PING_THROTTLE_MS = 5_000
const lastActivityBroadcast = new Map<string, number>()

/** Pure throttle predicate — testable without any WS machinery.
 *  Returns true if a ping should be sent now; caller must update the map. */
export function shouldBroadcastActivity(
  lastMap: Map<string, number>,
  sessionId: string,
  now: number,
  thresholdMs: number = ACTIVITY_PING_THROTTLE_MS,
): boolean {
  const last = lastMap.get(sessionId)
  if (last === undefined) return true
  return now - last >= thresholdMs
}

/** Broadcast an activity ping for a session if we haven't sent one for
 *  this session within the throttle window. Safe to call on every event.
 *  `projectId` is included so the client can pulse the project bucket
 *  without needing to look up its session list. */
export function broadcastActivity(
  sessionId: string,
  eventId: number,
  projectId: number | null,
): void {
  const now = Date.now()
  if (!shouldBroadcastActivity(lastActivityBroadcast, sessionId, now)) return
  lastActivityBroadcast.set(sessionId, now)
  broadcastToAll({ type: 'activity', data: { sessionId, projectId, eventId, ts: now } })
}

/** Clear the activity throttle state. Test-only. */
export function resetActivityThrottleForTests(): void {
  lastActivityBroadcast.clear()
}

/** Send a message to ALL connected clients (for global updates) */
export function broadcastToAll(message: object): void {
  const json = JSON.stringify(message)
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return allClients.size
}
