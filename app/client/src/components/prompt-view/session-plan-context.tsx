import { createContext, useContext } from 'react'
import type { SessionPlanContext } from '@/lib/plan'

/**
 * Session-wide task bookkeeping for the prompt view (tree badges and the
 * plan tab), built once per tree from all of the session's turns.
 */
export const SessionPlanCtx = createContext<SessionPlanContext | null>(null)

export function useSessionPlan(): SessionPlanContext | undefined {
  return useContext(SessionPlanCtx) ?? undefined
}
