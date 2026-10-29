import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useUIStore } from '@/stores/ui-store'

/**
 * Which session a block of session UI (breadcrumb, scope bar, timeline,
 * event stream…) is showing, plus that view's agent selection.
 *
 * The normal session view reads both from the global UI store. A compare
 * pane wraps its subtree in <SessionPaneProvider> so two panes can show two
 * sessions at once: each pane owns its session id and agent selection,
 * while filters, search and time range stay shared through the store.
 */
export interface SessionScope {
  sessionId: string | null
  selectedAgentIds: string[]
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  /** Set inside a compare pane; null in the normal single-session view. */
  pane: { index: number } | null
}

const SessionPaneContext = createContext<SessionScope | null>(null)

export function useSessionScope(): SessionScope {
  const pane = useContext(SessionPaneContext)
  const sessionId = useUIStore((s) => s.selectedSessionId)
  const selectedAgentIds = useUIStore((s) => s.selectedAgentIds)
  const setSelectedAgentIds = useUIStore((s) => s.setSelectedAgentIds)
  const toggleAgentId = useUIStore((s) => s.toggleAgentId)
  return useMemo(
    () => pane ?? { sessionId, selectedAgentIds, setSelectedAgentIds, toggleAgentId, pane: null },
    [pane, sessionId, selectedAgentIds, setSelectedAgentIds, toggleAgentId],
  )
}

export function SessionPaneProvider({
  sessionId,
  index,
  children,
}: {
  sessionId: string
  index: number
  children: ReactNode
}) {
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const value = useMemo<SessionScope>(
    () => ({
      sessionId,
      selectedAgentIds,
      setSelectedAgentIds,
      toggleAgentId: (id) =>
        setSelectedAgentIds((ids) =>
          ids.includes(id) ? ids.filter((a) => a !== id) : [...ids, id],
        ),
      pane: { index },
    }),
    [sessionId, selectedAgentIds, index],
  )
  return <SessionPaneContext.Provider value={value}>{children}</SessionPaneContext.Provider>
}

/** Accent per compare pane — the same colors mark each session wherever
 *  the compare view shows it. */
export const COMPARE_PANE_STYLES = [
  { label: 'A', border: 'border-t-sky-500', badge: 'bg-sky-500 text-white' },
  { label: 'B', border: 'border-t-amber-500', badge: 'bg-amber-500 text-white' },
] as const
