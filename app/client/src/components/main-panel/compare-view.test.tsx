import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, within, act } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { MainPanel } from './main-panel'
import { useSessionScope } from './session-scope'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import type { ParsedEvent, Agent } from '@/types'

import '@/agents/init'

// The compare view mounts the REAL EventStream in both panes, fed from a
// per-session event map, to check that neither pane shows the other
// session's events and that agent selection stays per pane.

const eventsBySession: Record<string, ParsedEvent[]> = {}
const agentsBySession: Record<string, Agent[]> = {}

vi.mock('@/hooks/use-events', () => ({
  useEvents: (sessionId: string | null) => ({
    data: sessionId ? eventsBySession[sessionId] : undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}))
vi.mock('@/hooks/use-agents', () => ({
  useAgents: (sessionId: string | null) => (sessionId ? (agentsBySession[sessionId] ?? []) : []),
}))
vi.mock('@/hooks/use-permission-mode-backfill', () => ({ usePermissionModeBackfill: () => {} }))
vi.mock('@/lib/api-client', () => ({ api: { getSession: () => new Promise(() => {}) } }))
vi.mock('timeago.js', () => ({ format: () => 'just now' }))

// Probes that expose each pane's scope instead of the real chrome.
vi.mock('./session-breadcrumb', () => ({
  SessionBreadcrumb: () => {
    const { sessionId, pane } = useSessionScope()
    return <div data-testid="scope">{`${pane?.index ?? '-'}:${sessionId}`}</div>
  },
}))
vi.mock('./scope-bar', () => ({
  ScopeBar: () => {
    const { sessionId, toggleAgentId } = useSessionScope()
    return <button onClick={() => toggleAgentId(`${sessionId}-sub`)}>pick subagent</button>
  },
}))
vi.mock('./event-filter-bar', () => ({ EventFilterBar: () => null }))
vi.mock('@/components/timeline/activity-timeline', () => ({ ActivityTimeline: () => null }))

function prompt(id: number, sessionId: string, agentId: string, text: string): ParsedEvent {
  return {
    id,
    sessionId,
    agentId,
    hookName: 'UserPromptSubmit',
    timestamp: 1700000000000 + id,
    createdAt: 1700000000000 + id,
    payload: { prompt: text },
  } as ParsedEvent
}

function agent(id: string, sessionId: string, parentAgentId: string | null = null): Agent {
  return {
    id,
    sessionId,
    parentAgentId,
    name: null,
    description: null,
    agentClass: 'claude-code',
    status: 'active',
    eventCount: 0,
    firstEventAt: 1700000000000,
    lastEventAt: 1700000000000,
  }
}

const pane = (index: number) =>
  document.querySelector<HTMLElement>(`[data-compare-pane="${index}"]`)!

beforeEach(() => {
  eventsBySession['sess-a'] = [
    prompt(1, 'sess-a', 'sess-a', 'alpha main prompt'),
    prompt(2, 'sess-a', 'sess-a-sub', 'alpha subagent prompt'),
  ]
  eventsBySession['sess-b'] = [prompt(3, 'sess-b', 'sess-b', 'beta main prompt')]
  agentsBySession['sess-a'] = [agent('sess-a', 'sess-a'), agent('sess-a-sub', 'sess-a', 'sess-a')]
  agentsBySession['sess-b'] = [agent('sess-b', 'sess-b')]
  useFilterStore.setState({ filters: [], compiled: [], loaded: true })
  useUIStore.setState({
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    compareSessionIds: ['sess-a', 'sess-b'],
    selectedAgentIds: [],
    activePrimaryFilters: [],
    activeSecondaryFilters: [],
    searchQuery: '',
    streamView: 'raw',
    rewindMode: false,
    frozenEvents: null,
    autoFollow: true,
    expandedEventIds: new Set(),
    sessionFilterStates: new Map(),
  })
})

describe('compare view', () => {
  it('gives each pane its own session', () => {
    renderWithProviders(<MainPanel />)
    expect(within(pane(0)).getByTestId('scope').textContent).toBe('0:sess-a')
    expect(within(pane(1)).getByTestId('scope').textContent).toBe('1:sess-b')
  })

  it('shows each session’s events only in its own pane', () => {
    renderWithProviders(<MainPanel />)
    expect(within(pane(0)).getByText('alpha main prompt')).toBeInTheDocument()
    expect(within(pane(0)).queryByText('beta main prompt')).toBeNull()
    expect(within(pane(1)).getByText('beta main prompt')).toBeInTheDocument()
    expect(within(pane(1)).queryByText('alpha main prompt')).toBeNull()
    expect(within(pane(1)).queryByText('alpha subagent prompt')).toBeNull()
  })

  it('keeps agent selection per pane, out of the global store', () => {
    renderWithProviders(<MainPanel />)
    act(() => within(pane(0)).getByText('pick subagent').click())

    // Pane A now shows only its subagent's events…
    expect(within(pane(0)).getByText('alpha subagent prompt')).toBeInTheDocument()
    expect(within(pane(0)).queryByText('alpha main prompt')).toBeNull()
    // …while pane B and the global selection are untouched.
    expect(within(pane(1)).getByText('beta main prompt')).toBeInTheDocument()
    expect(useUIStore.getState().selectedAgentIds).toEqual([])
  })

  it('renders the normal session view once compare is closed', () => {
    useUIStore.setState({ compareSessionIds: null, selectedSessionId: 'sess-b' })
    renderWithProviders(<MainPanel />)
    expect(document.querySelector('[data-compare-pane]')).toBeNull()
    expect(screen.getByTestId('scope').textContent).toBe('-:sess-b')
    expect(screen.getByText('beta main prompt')).toBeInTheDocument()
  })
})
