import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

// Compare view state + its `#/~compare/<a>/<b>` route.

function navigateTo(hash: string) {
  window.location.hash = hash
  window.dispatchEvent(new Event('hashchange'))
}

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    compareSessionIds: null,
    compareSelection: [],
    currentView: null,
    editingSessionId: null,
    rewindMode: false,
    frozenEvents: null,
  })
  window.history.replaceState(null, '', '#/')
})

describe('compare selection', () => {
  it('holds at most two sessions', () => {
    const { toggleCompareSelection } = useUIStore.getState()
    toggleCompareSelection('a')
    toggleCompareSelection('b')
    toggleCompareSelection('c')
    expect(useUIStore.getState().compareSelection).toEqual(['a', 'b'])
  })

  it('unchecking frees a slot', () => {
    const { toggleCompareSelection } = useUIStore.getState()
    toggleCompareSelection('a')
    toggleCompareSelection('b')
    toggleCompareSelection('a')
    toggleCompareSelection('c')
    expect(useUIStore.getState().compareSelection).toEqual(['b', 'c'])
  })
})

describe('openCompare', () => {
  it('opens two sessions, clears the single selection, and writes the URL', () => {
    useUIStore.getState().openSession(3, 'proj', 'a')
    useUIStore.setState({ compareSelection: ['a', 'b'] })
    useUIStore.getState().openCompare(['a', 'b'])

    const s = useUIStore.getState()
    expect(s.compareSessionIds).toEqual(['a', 'b'])
    expect(s.selectedSessionId).toBeNull()
    expect(s.selectedProjectId).toBeNull()
    expect(s.compareSelection).toEqual([])
    expect(window.location.hash).toBe('#/~compare/a/b')
  })

  it('ignores fewer than two distinct sessions', () => {
    useUIStore.getState().openCompare(['a', 'a'])
    expect(useUIStore.getState().compareSessionIds).toBeNull()
  })

  it('leaves rewind mode, whose frozen events belong to one session', () => {
    useUIStore.setState({ rewindMode: true, frozenEvents: [] })
    useUIStore.getState().openCompare(['a', 'b'])
    expect(useUIStore.getState().rewindMode).toBe(false)
    expect(useUIStore.getState().frozenEvents).toBeNull()
  })

  it('keeps the compare route when a session modal opens from a pane', () => {
    useUIStore.getState().openCompare(['a', 'b'])
    useUIStore.getState().setEditingSessionId('b', 'stats')
    expect(window.location.hash).toBe('#/~compare/a/b:session.stats@b')
    expect(useUIStore.getState().compareSessionIds).toEqual(['a', 'b'])
  })
})

describe('leaving compare', () => {
  it('closing a pane opens the other session', () => {
    useUIStore.getState().openCompare(['a', 'b'])
    useUIStore.getState().closeComparePane('a')
    const s = useUIStore.getState()
    expect(s.compareSessionIds).toBeNull()
    expect(s.selectedSessionId).toBe('b')
    expect(window.location.hash).toBe('#/_/b')
  })

  it('selecting a session or project exits compare', () => {
    useUIStore.getState().openCompare(['a', 'b'])
    useUIStore.getState().setSelectedSessionId('c')
    expect(useUIStore.getState().compareSessionIds).toBeNull()

    useUIStore.getState().openCompare(['a', 'b'])
    useUIStore.getState().setSelectedProject(1, 'proj')
    expect(useUIStore.getState().compareSessionIds).toBeNull()
  })
})

describe('compare route (browser navigation)', () => {
  it('opens compare from the URL', () => {
    navigateTo('#/~compare/x/y')
    expect(useUIStore.getState().compareSessionIds).toEqual(['x', 'y'])
    expect(useUIStore.getState().selectedSessionId).toBeNull()
  })

  it('Back to home clears compare', () => {
    navigateTo('#/~compare/x/y')
    navigateTo('#/')
    expect(useUIStore.getState().compareSessionIds).toBeNull()
  })

  it('Back to a session clears compare and selects it', () => {
    navigateTo('#/~compare/x/y')
    navigateTo('#/_/x')
    expect(useUIStore.getState().compareSessionIds).toBeNull()
    expect(useUIStore.getState().selectedSessionId).toBe('x')
  })

  it('a compare URL with one distinct id opens that session', () => {
    navigateTo('#/~compare/x/x')
    expect(useUIStore.getState().compareSessionIds).toBeNull()
    expect(useUIStore.getState().selectedSessionId).toBe('x')
  })
})
