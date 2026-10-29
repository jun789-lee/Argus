// Builds the session's "turn tree": session-level system events, the
// user's prompts, and the subagents each prompt spawned (recursively),
// each node holding the raw events that belong to it.
//
//   ⚙ system  (SessionStart, ConfigChange, … between prompts)
//   💬 prompt  (UserPromptSubmit … Stop of the main agent)
//     🤖 subagent  (its own events; may spawn further subagents)
//
// Membership rules, most to least precise:
//   1. Claude Code stamps `prompt_id` on (almost) every hook payload, so an
//      event belongs to the prompt whose UserPromptSubmit carried that id.
//   2. Events without a known prompt_id fall back to the main-agent prompt
//      that was open (submitted, not yet stopped) at that time.
//   3. Session-level hooks always form system nodes, even when they carry a
//      prompt_id, so they read as their own rows in the prompt list.
// Subagents are keyed by agentId. Their parent is the agent whose
// PostToolUse:Agent returned the child's id (exact), or failing that the
// prompt open when the child first appeared (live, before the tool returns).

export interface TreeEvent {
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
}

export type TurnNodeKind = 'system' | 'prompt' | 'subagent'
export type TurnStatus = 'running' | 'waiting' | 'done' | 'failed' | 'interrupted'

export interface TurnNode<E extends TreeEvent = TreeEvent> {
  /** Stable across rebuilds: prompt_id, agent id, or first event id. */
  id: string
  kind: TurnNodeKind
  agentId: string
  /** Prompt text (prompt), task description (subagent), or hook names (system). */
  title: string
  /** Full prompt handed to this turn, when known. */
  prompt: string | null
  /** Subagent type (e.g. "Explore"), subagents only. */
  agentType: string | null
  /** This node's own events, time-ordered. Children's events are not included. */
  events: E[]
  children: TurnNode<E>[]
  startedAt: number
  /** When the turn finished (Stop / SubagentStop), null while running. */
  endedAt: number | null
  lastEventAt: number
  status: TurnStatus
  /** Distinct tool calls in this node's own events. */
  toolCount: number
  /** Failed tool calls in this node's own events. */
  errorCount: number
}

/** Hooks that describe the session rather than a prompt's work. */
export const SYSTEM_HOOKS = new Set([
  'SessionStart',
  'SessionEnd',
  'Setup',
  'ConfigChange',
  'InstructionsLoaded',
  'PreCompact',
  'PostCompact',
  'WorktreeRemove',
])

const PROMPT_END_HOOKS = new Set(['Stop', 'StopFailure'])
const WAITING_HOOKS = new Set(['Notification', 'PermissionRequest'])
const TOOL_HOOKS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function firstLine(s: string, max = 120): string {
  const line = s.trim().split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function byTime<E extends TreeEvent>(a: E, b: E): number {
  return a.timestamp - b.timestamp || a.id - b.id
}

function newNode<E extends TreeEvent>(
  kind: TurnNodeKind,
  id: string,
  agentId: string,
  first: E,
): TurnNode<E> {
  return {
    id,
    kind,
    agentId,
    title: '',
    prompt: null,
    agentType: null,
    events: [],
    children: [],
    startedAt: first.timestamp,
    endedAt: null,
    lastEventAt: first.timestamp,
    status: kind === 'system' ? 'done' : 'running',
    toolCount: 0,
    errorCount: 0,
  }
}

export function buildTurnTree<E extends TreeEvent>(
  input: E[],
  opts: { sessionId: string },
): TurnNode<E>[] {
  const events = [...input].sort(byTime)
  const mainIds = new Set([opts.sessionId, `${opts.sessionId}:background`])
  const isMain = (agentId: string) => mainIds.has(agentId)

  // ---- Pass 1: prompts, and subagent spawn metadata ----------------------
  const prompts = new Map<string, TurnNode<E>>() // prompt_id → node
  const promptOrder: TurnNode<E>[] = []
  // tool_use_id → Agent tool input; child agentId → { parent agent, input }
  type Spawn = { parentAgentId: string; promptId: string | null; input: Record<string, unknown> }
  const agentCalls = new Map<string, Spawn>()
  const spawnedBy = new Map<string, Spawn>()
  for (const e of events) {
    const p = e.payload ?? {}
    if (e.hookName === 'UserPromptSubmit' && isMain(e.agentId)) {
      const id = str(p.prompt_id) ?? `prompt-${e.id}`
      if (!prompts.has(id)) {
        const node = newNode('prompt', id, e.agentId, e)
        node.prompt = str(p.prompt)
        node.title = firstLine(node.prompt ?? '')
        prompts.set(id, node)
        promptOrder.push(node)
      }
    }
    if (p.tool_name === 'Agent') {
      const useId = str(p.tool_use_id)
      const input = (p.tool_input ?? {}) as Record<string, unknown>
      const spawn: Spawn = { parentAgentId: e.agentId, promptId: str(p.prompt_id), input }
      if (e.hookName === 'PreToolUse' && useId) agentCalls.set(useId, spawn)
      if (e.hookName === 'PostToolUse') {
        const child = str((p.tool_response as Record<string, unknown> | undefined)?.agentId)
        const call = useId ? agentCalls.get(useId) : undefined
        if (child && !spawnedBy.has(child)) spawnedBy.set(child, call ?? spawn)
      }
    }
  }

  // Main-agent prompt open at time `ts` (fallback for events without a usable prompt_id).
  const promptAt = (ts: number): TurnNode<E> | null => {
    let found: TurnNode<E> | null = null
    for (const node of promptOrder) {
      if (node.startedAt > ts) break
      found = node
    }
    return found && (found.endedAt === null || ts <= found.endedAt) ? found : null
  }

  // ---- Pass 2: assign events ---------------------------------------------
  const roots: TurnNode<E>[] = [...promptOrder]
  const subagents = new Map<string, TurnNode<E>>() // agentId → node
  let openSystem: TurnNode<E> | null = null

  for (const e of events) {
    const p = e.payload ?? {}

    if (!isMain(e.agentId)) {
      let node = subagents.get(e.agentId)
      if (!node) {
        node = newNode('subagent', e.agentId, e.agentId, e)
        subagents.set(e.agentId, node)
      }
      node.events.push(e)
      if (e.hookName === 'SubagentStart') node.agentType = str(p.agent_type) ?? node.agentType
      continue
    }

    if (SYSTEM_HOOKS.has(e.hookName)) {
      if (!openSystem) {
        openSystem = newNode('system', `system-${e.id}`, e.agentId, e)
        roots.push(openSystem)
      }
      openSystem.events.push(e)
      continue
    }

    const pid = str(p.prompt_id)
    const prompt = (pid && prompts.get(pid)) || promptAt(e.timestamp)
    if (!prompt) {
      if (!openSystem) {
        openSystem = newNode('system', `system-${e.id}`, e.agentId, e)
        roots.push(openSystem)
      }
      openSystem.events.push(e)
      continue
    }
    openSystem = null
    prompt.events.push(e)
    if (PROMPT_END_HOOKS.has(e.hookName) && prompt.endedAt === null) {
      prompt.endedAt = e.timestamp
      prompt.status = e.hookName === 'StopFailure' ? 'failed' : 'done'
    }
    // A SubagentStop (logged under the parent) closes the child it names.
    if (e.hookName === 'SubagentStop') {
      const child = subagents.get(str(p.agent_id) ?? '')
      if (child && child.endedAt === null) {
        child.endedAt = e.timestamp
        child.status = 'done'
      }
    }
  }

  // ---- Pass 3: attach subagents to parents --------------------------------
  const promptOfAgentEvents = (node: TurnNode<E>): TurnNode<E> | null => {
    for (const e of node.events) {
      const pid = str(e.payload?.prompt_id)
      if (pid && prompts.has(pid)) return prompts.get(pid)!
    }
    return promptAt(node.startedAt)
  }
  for (const node of subagents.values()) {
    const spawn = spawnedBy.get(node.agentId)
    if (spawn) {
      node.prompt = str(spawn.input.prompt)
      node.title = firstLine(str(spawn.input.description) ?? node.prompt ?? '')
      node.agentType = node.agentType ?? str(spawn.input.subagent_type)
    }
    node.title = node.title || (node.agentType ?? '')
    const parentSubagent =
      spawn && !isMain(spawn.parentAgentId) ? subagents.get(spawn.parentAgentId) : undefined
    const parent =
      (parentSubagent !== node ? parentSubagent : undefined) ??
      (spawn?.promptId ? prompts.get(spawn.promptId) : undefined) ??
      promptOfAgentEvents(node)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  // ---- Pass 4: per-node stats and status ----------------------------------
  const seen = new Set<TurnNode<E>>()
  const walk = (node: TurnNode<E>) => {
    if (seen.has(node)) return // defensive: a malformed spawn cycle
    seen.add(node)
    node.events.sort(byTime)
    node.children.sort((a, b) => a.startedAt - b.startedAt)
    const toolIds = new Set<string>()
    for (const e of node.events) {
      node.lastEventAt = Math.max(node.lastEventAt, e.timestamp)
      node.startedAt = Math.min(node.startedAt, e.timestamp)
      if (TOOL_HOOKS.has(e.hookName)) toolIds.add(str(e.payload?.tool_use_id) ?? `e${e.id}`)
      if (e.hookName === 'PostToolUseFailure') node.errorCount++
      if (node.kind === 'subagent' && e.hookName === 'SubagentStop' && node.endedAt === null) {
        node.endedAt = e.timestamp
        node.status = 'done'
      }
    }
    node.toolCount = toolIds.size
    if (node.kind === 'system') {
      node.title = [...new Set(node.events.map((e) => e.hookName))].join(' · ')
      node.endedAt = node.lastEventAt
    }
    if (node.status === 'running') {
      const last = node.events[node.events.length - 1]
      if (last && WAITING_HOOKS.has(last.hookName)) node.status = 'waiting'
    }
    node.children.forEach(walk)
  }
  roots.forEach(walk)

  // A prompt that never stopped but was followed by another one was
  // interrupted (Esc / killed) — Stop doesn't fire in that case.
  promptOrder.forEach((node, i) => {
    if (node.endedAt === null && i < promptOrder.length - 1) {
      node.status = 'interrupted'
      node.endedAt = node.lastEventAt
    }
  })

  return roots.sort((a, b) => a.startedAt - b.startedAt || (a.kind === 'system' ? -1 : 1))
}
