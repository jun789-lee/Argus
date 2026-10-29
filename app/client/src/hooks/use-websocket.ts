import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getServerHealth } from '@/lib/server-health'
import type { WSMessage, WSClientMessage, ParsedEvent, Session, RecentSession } from '@/types'
import { pushNotification, clearNotification } from '@/components/sidebar/notification-indicator'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'

/** Patch the ['sessions', *] and ['recent-sessions', *] query caches so
 *  that any row matching sessionId with status='ended' flips to 'active'.
 *  Called from the activity WS handler to close the gap between a ping
 *  arriving and the next sessions refetch. */
/**
 * On an activity ping, clear `stoppedAt` for the session in any cached
 * sessions list — the activity is fresh evidence the session has come
 * back to life. The status field this used to bump is gone (Phase 5
 * dropped it in favor of deriving from `stoppedAt`); now we only patch
 * when the session was actually stopped, otherwise it's a no-op.
 */
function markSessionActiveInCache(queryClient: QueryClient, sessionId: string): void {
  queryClient.setQueriesData<Session[]>({ queryKey: ['sessions'] }, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((s) => {
      if (s.id === sessionId && s.stoppedAt != null) {
        changed = true
        return { ...s, stoppedAt: null }
      }
      return s
    })
    return changed ? next : old
  })
  queryClient.setQueriesData<RecentSession[]>({ queryKey: ['recent-sessions'] }, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((s) => {
      if (s.id === sessionId && s.stoppedAt != null) {
        changed = true
        return { ...s, stoppedAt: null }
      }
      return s
    })
    return changed ? next : old
  })
}

const WS_URL = `ws://${window.location.host}/api/events/stream`

// Fetch log level from server once on module load. Shares the page-
// wide /api/health fetch with the version footer + settings modal.
let logLevel: 'debug' | 'trace' | 'none' = 'none'
getServerHealth().then((data) => {
  const level = (data?.logLevel || '').toLowerCase()
  if (level === 'trace') logLevel = 'trace'
  else if (level === 'debug') logLevel = 'debug'
})

/** Stable string key for a set of session ids, so callers can pass a
 *  fresh array every render without re-sending the subscription. Order and
 *  duplicates don't matter. */
export function subscriptionKey(sessionIds: readonly string[]): string {
  return [...new Set(sessionIds.filter(Boolean))].sort().join('\n')
}

/** Inverse of `subscriptionKey`. */
export function idsFromKey(key: string): string[] {
  return key === '' ? [] : key.split('\n')
}

/** Which session an incoming event belongs to, or `null` to drop it.
 *  The server always tags events, but if a tag is missing we only fall
 *  back to the subscription when exactly one session is subscribed —
 *  guessing with two or more would file the event under the wrong one. */
export function resolveEventSessionId(
  wireSessionId: string | null | undefined,
  subscribed: ReadonlySet<string>,
): string | null {
  if (wireSessionId) return subscribed.has(wireSessionId) ? wireSessionId : null
  if (subscribed.size === 1) return subscribed.values().next().value ?? null
  return null
}

/** Group buffered events by their own sessionId, keeping arrival order
 *  and skipping sessions that are no longer subscribed. Each group is
 *  written to that session's `['events', id]` cache — never another's. */
export function groupEventsBySession(
  events: readonly ParsedEvent[],
  subscribed: ReadonlySet<string>,
): Map<string, ParsedEvent[]> {
  const groups = new Map<string, ParsedEvent[]>()
  for (const event of events) {
    const sessionId = event.sessionId
    if (!sessionId || !subscribed.has(sessionId)) continue
    const group = groups.get(sessionId)
    if (group) group.push(event)
    else groups.set(sessionId, [event])
  }
  return groups
}

/** Subscribe to live events for every session in `sessionIds`. Pass an
 *  empty array to receive only global updates. */
export function useWebSocket(sessionIds: readonly string[]) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const subKey = subscriptionKey(sessionIds)
  const subscribedRef = useRef<Set<string>>(new Set())
  subscribedRef.current = new Set(idsFromKey(subKey))

  const sendMessage = useCallback((msg: WSClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // Send the full subscription list whenever it changes
  useEffect(() => {
    if (!connected) return
    const ids = idsFromKey(subKey)
    if (ids.length > 0) {
      sendMessage({ type: 'subscribe', sessionIds: ids })
      if (logLevel === 'debug' || logLevel === 'trace') {
        console.log(`[WS] Subscribing to sessions ${ids.map((id) => id.slice(0, 8)).join(', ')}`)
      }
    } else {
      sendMessage({ type: 'unsubscribe' })
      if (logLevel === 'debug' || logLevel === 'trace') {
        console.log('[WS] Unsubscribed (no session selected)')
      }
    }
    // Drop buffered events for sessions that were just unsubscribed; keep
    // the rest so a session that stays subscribed doesn't lose events.
    const subscribed = new Set(ids)
    eventBufferRef.current = eventBufferRef.current.filter(
      (e) => !!e.sessionId && subscribed.has(e.sessionId),
    )
  }, [subKey, connected, sendMessage])

  // Batch incoming events to avoid O(N) array copies per event.
  // Events accumulate in a buffer and flush to the cache every 100ms.
  const eventBufferRef = useRef<ParsedEvent[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const flushEventBuffer = useCallback(() => {
    const buffer = eventBufferRef.current
    if (buffer.length === 0) return
    eventBufferRef.current = []
    for (const [sessionId, events] of groupEventsBySession(buffer, subscribedRef.current)) {
      queryClient.setQueryData<ParsedEvent[]>(['events', sessionId], (old) =>
        old ? [...old, ...events] : [...events],
      )
    }
    if (logLevel === 'trace') {
      console.debug(`[WS] Flushed ${buffer.length} events to cache`)
    }
  }, [queryClient])

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === 'event') {
        // Reshape WS broadcast into the canonical client `ParsedEvent`.
        // The server may emit either camelCase fields (`agentId`,
        // `hookName`) or the spec-canonical snake_case (`agent_id`,
        // `hook_name`) — accept both.
        const wire = msg.data
        const subscribed = subscribedRef.current
        const sessionId = resolveEventSessionId(wire.sessionId ?? wire.session_id, subscribed)
        if (!sessionId) return
        const event: ParsedEvent = {
          id: wire.id,
          timestamp: wire.timestamp,
          agentId: (wire.agentId ?? wire.agent_id ?? '') as string,
          sessionId,
          hookName: (wire.hookName ?? wire.hook_name ?? '') as string,
          payload: wire.payload,
          cwd: wire.cwd ?? null,
          _meta: wire._meta ?? null,
        }
        eventBufferRef.current.push(event)
        if (!flushTimerRef.current) {
          // Adaptive flush interval: fast for small sessions, slower for large
          // ones to avoid O(n) recomputation storms every 100ms on 10k+ events.
          // The timer is shared, so size it for the largest subscribed session.
          let cacheSize = 0
          for (const id of subscribed) {
            const size = queryClient.getQueryData<ParsedEvent[]>(['events', id])?.length ?? 0
            if (size > cacheSize) cacheSize = size
          }
          const flushMs = cacheSize > 5000 ? 1000 : cacheSize > 1000 ? 500 : 100
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = undefined
            flushEventBuffer()
          }, flushMs)
        }
        if (logLevel === 'trace') {
          console.debug(`[WS] Event buffered: ${event.hookName} (${sessionId.slice(0, 8)})`)
        }
      } else if (msg.type === 'session_update') {
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        // recent-sessions and unassigned-sessions have separate cache
        // key prefixes; invalidate explicitly so the home page + sidebar
        // Unassigned bucket pick up new / changed sessions without
        // needing a polling timer.
        queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
        queryClient.invalidateQueries({ queryKey: ['unassigned-sessions'] })
        // Only invalidate the specific session that changed, not all ['session', *] queries
        const sessionData = msg.data as { id?: string }
        if (sessionData.id) {
          queryClient.invalidateQueries({ queryKey: ['session', sessionData.id] })
        }
        if (logLevel === 'trace') {
          console.debug(
            `[WS] Session update → invalidating sessions + session ${sessionData.id?.slice(0, 8) ?? '?'}`,
          )
        }
      } else if (msg.type === 'project_update') {
        queryClient.invalidateQueries({ queryKey: ['projects'] })
        // Project changes (rename, slug edit, deletion) can affect
        // sessions' projectName / projectSlug fields shown in the
        // recent-sessions response too.
        queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
        if (logLevel === 'trace') {
          console.debug('[WS] Project update → invalidating projects')
        }
      } else if (msg.type === 'notification') {
        const { sessionId, projectId, ts } = msg.data
        pushNotification({ sessionId, projectId, ts })
        if (logLevel === 'trace') {
          console.debug(`[WS] Notification → session ${sessionId.slice(0, 8)}`)
        }
      } else if (msg.type === 'notification_clear') {
        const { sessionId, ts } = msg.data
        clearNotification(sessionId, ts)
      } else if (msg.type === 'activity') {
        const { sessionId, projectId } = msg.data
        useUIStore.getState().pulseSession(sessionId, projectId)
        // Flip any cached Session rows for this session to 'active'.
        // Covers the gap where a ping arrives for a session that the
        // most recent /sessions fetch still has marked 'ended'. Next
        // refetch re-syncs from the server, so this is client-side
        // only and non-destructive.
        markSessionActiveInCache(queryClient, sessionId)
      } else if (msg.type === 'filter:created') {
        useFilterStore.getState().upsertFromBroadcast(msg.filter)
      } else if (msg.type === 'filter:updated') {
        useFilterStore.getState().upsertFromBroadcast(msg.filter)
      } else if (msg.type === 'filter:deleted') {
        useFilterStore.getState().removeFromBroadcast(msg.id)
      } else if (msg.type === 'filter:bulk-changed') {
        void useFilterStore.getState().bulkChangedFromBroadcast()
      }
    },
    [queryClient],
  )

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
      // Guard against duplicate connections (e.g. from StrictMode reconnect races)
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return

      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          console.log('[WS] Connected')
          // Re-send the current subscription list on (re)connect
          const ids = [...subscribedRef.current]
          if (ids.length > 0) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionIds: ids }))
            if (logLevel === 'debug' || logLevel === 'trace') {
              console.log(
                `[WS] Subscribing to sessions ${ids.map((id) => id.slice(0, 8)).join(', ')} (on connect)`,
              )
            }
          }
        }

        ws.onmessage = (wsEvent) => {
          try {
            const msg: WSMessage = JSON.parse(wsEvent.data)
            handleMessage(msg)
          } catch {}
        }

        ws.onclose = () => {
          // Only handle if this is still the active connection — avoids
          // clobbering a newer connection during StrictMode remount races
          if (wsRef.current !== ws) return
          setConnected(false)
          wsRef.current = null
          console.log('[WS] Disconnected, retrying in 3s...')
          reconnectTimeoutRef.current = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        reconnectTimeoutRef.current = setTimeout(connectWs, 5000)
      }
    }

    // Kick off initial filter load — independent of WS connection.
    void useFilterStore.getState().load()

    connectWs()

    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      clearTimeout(flushTimerRef.current)
      flushEventBuffer()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [handleMessage])

  return { connected }
}
