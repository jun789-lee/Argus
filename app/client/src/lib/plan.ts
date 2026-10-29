// Derives a prompt's plan — its steps, what ran under each step, and
// overall progress — from the task list Claude keeps while working.
//
// Sources, best first:
//   tasks   — TaskCreate / TaskUpdate tools and TaskCreated / TaskCompleted hooks
//   todos   — legacy TodoWrite, which re-sends the full list on every call
//   replies — no task list: each text reply starts a step (no total known)
// Tool calls and subagents are assigned to the step that was in progress
// when they started (latest-started wins when steps overlap).

import type { TreeEvent, TurnNode } from './turn-tree'

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  id: string
  title: string
  /** Present-tense label shown while the step runs ("Running tests"). */
  activeForm: string | null
  status: StepStatus
  startedAt: number | null
  endedAt: number | null
  toolCount: number
  errorCount: number
  subagents: TurnNode[]
}

export interface Plan {
  source: 'tasks' | 'todos' | 'replies' | 'none'
  steps: PlanStep[]
  /** Work that started outside every step's window. */
  unassigned: { toolCount: number; errorCount: number; subagents: TurnNode[] }
  completed: number
  total: number
  /** 0–1, or null when the total is unknown (replies / none). */
  progress: number | null
}

const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function firstLine(s: string, max = 100): string {
  const line =
    s
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? ''
  const clean = line.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** All events of the node and its descendants, time-ordered. */
function allEvents(node: TurnNode): TreeEvent[] {
  const out: TreeEvent[] = [...node.events]
  const walk = (n: TurnNode) => n.children.forEach((c) => (out.push(...c.events), walk(c)))
  walk(node)
  return out.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
}

function newStep(id: string, title: string): PlanStep {
  return {
    id,
    title,
    activeForm: null,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    toolCount: 0,
    errorCount: 0,
    subagents: [],
  }
}

function setStatus(step: PlanStep, status: unknown, ts: number) {
  if (status === 'in_progress') {
    step.status = 'in_progress'
    step.startedAt ??= ts
  } else if (status === 'completed') {
    step.status = 'completed'
    step.startedAt ??= ts
    step.endedAt ??= ts
  } else if (status === 'pending') {
    step.status = 'pending'
  }
}

function fromTasks(events: TreeEvent[]): PlanStep[] {
  const steps = new Map<string, PlanStep>()
  const deleted = new Set<string>()
  for (const e of events) {
    const p = e.payload ?? {}
    const input = (p.tool_input ?? {}) as Record<string, unknown>
    const response = (p.tool_response ?? {}) as Record<string, unknown>
    if (e.hookName === 'TaskCreated') {
      const id = str(p.task_id)
      if (id && !steps.has(id)) steps.set(id, newStep(id, str(p.task_subject) ?? id))
    } else if (e.hookName === 'TaskCompleted') {
      const step = steps.get(str(p.task_id) ?? '')
      if (step) setStatus(step, 'completed', e.timestamp)
    } else if (e.hookName === 'PostToolUse' && p.tool_name === 'TaskCreate') {
      const task = (response.task ?? {}) as Record<string, unknown>
      const id = str(response.taskId) ?? str(task.id)
      if (id) {
        const step = steps.get(id) ?? newStep(id, str(input.subject) ?? id)
        step.title = str(input.subject) ?? step.title
        step.activeForm = str(input.activeForm) ?? step.activeForm
        steps.set(id, step)
      }
    } else if (e.hookName === 'PostToolUse' && p.tool_name === 'TaskUpdate') {
      const id = str(input.taskId)
      if (!id) continue
      if (input.status === 'deleted') {
        deleted.add(id)
        continue
      }
      const step = steps.get(id) ?? newStep(id, str(input.subject) ?? id)
      steps.set(id, step)
      if (str(input.subject)) step.title = str(input.subject)!
      if (str(input.activeForm)) step.activeForm = str(input.activeForm)
      const change = response.statusChange as Record<string, unknown> | undefined
      setStatus(step, change?.to ?? input.status, e.timestamp)
    }
  }
  return [...steps.values()].filter((s) => !deleted.has(s.id))
}

function fromTodos(events: TreeEvent[]): PlanStep[] {
  const steps = new Map<string, PlanStep>()
  let latest: string[] = []
  for (const e of events) {
    if (e.hookName !== 'PreToolUse' || e.payload?.tool_name !== 'TodoWrite') continue
    const todos = (e.payload.tool_input as Record<string, unknown> | undefined)?.todos
    if (!Array.isArray(todos)) continue
    latest = []
    for (const todo of todos as Array<Record<string, unknown>>) {
      const title = str(todo.content)
      if (!title) continue
      latest.push(title)
      const step = steps.get(title) ?? newStep(`todo-${steps.size}`, title)
      step.activeForm = str(todo.activeForm) ?? step.activeForm
      setStatus(step, todo.status, e.timestamp)
      steps.set(title, step)
    }
  }
  // The last snapshot is the current plan; dropped items are gone.
  return latest.map((t) => steps.get(t)!)
}

function fromReplies(
  node: TurnNode,
  replies: Array<{ timestamp: number; text: string }>,
): PlanStep[] {
  return replies.map((r, i) => {
    const step = newStep(`reply-${i}`, firstLine(r.text))
    step.startedAt = r.timestamp
    step.endedAt = replies[i + 1]?.timestamp ?? node.endedAt
    step.status = step.endedAt !== null ? 'completed' : 'in_progress'
    return step
  })
}

/** Index of the step in progress at `ts` (latest-started wins), or -1. */
function stepAt(steps: PlanStep[], ts: number): number {
  let best = -1
  steps.forEach((s, i) => {
    if (s.startedAt === null || s.startedAt > ts) return
    if (s.endedAt !== null && s.endedAt < ts) return
    if (best === -1 || s.startedAt >= steps[best].startedAt!) best = i
  })
  return best
}

/**
 * Session-wide task bookkeeping. Claude's task list lives for the whole
 * session: a task created in one prompt is often updated or finished in a
 * later one. With this context each task belongs to the node that created
 * it, carries its latest status from anywhere in the session, and later
 * prompts list it as continued work instead of an orphan step.
 */
export interface SessionPlanContext {
  /** Every task's full lifecycle, keyed by task id. */
  tasks: Map<string, PlanStep>
  /** task id → id of the node (prompt or subagent) that created it. */
  origin: Map<string, string>
  /** task id → end of the prompt that last touched it (bounds open steps). */
  windowCap: Map<string, number>
  /** Main-agent events of every prompt, time-ordered (work attribution). */
  mainEvents: TreeEvent[]
  /** Every subagent in the session. */
  subagents: TurnNode[]
}

function taskIdOf(e: TreeEvent): string | null {
  const p = e.payload ?? {}
  if (e.hookName === 'TaskCreated' || e.hookName === 'TaskCompleted') return str(p.task_id)
  if (p.tool_name === 'TaskUpdate') return str((p.tool_input as Record<string, unknown>)?.taskId)
  if (p.tool_name === 'TaskCreate' && e.hookName === 'PostToolUse') {
    const r = (p.tool_response ?? {}) as Record<string, unknown>
    return str(r.taskId) ?? str((r.task as Record<string, unknown> | undefined)?.id)
  }
  return null
}

export function buildSessionPlanContext(roots: TurnNode[]): SessionPlanContext {
  const nodeOf = new Map<number, TurnNode>()
  const all: TreeEvent[] = []
  const mainEvents: TreeEvent[] = []
  const subagents: TurnNode[] = []
  const walk = (n: TurnNode) => {
    for (const e of n.events) {
      nodeOf.set(e.id, n)
      all.push(e)
      if (n.kind === 'prompt') mainEvents.push(e)
    }
    if (n.kind === 'subagent') subagents.push(n)
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  const byTime = (a: TreeEvent, b: TreeEvent) => a.timestamp - b.timestamp || a.id - b.id
  all.sort(byTime)
  mainEvents.sort(byTime)

  const tasks = new Map(fromTasks(all).map((s) => [s.id, s]))
  const origin = new Map<string, string>()
  const windowCap = new Map<string, number>()
  for (const e of all) {
    const id = taskIdOf(e)
    const owner = nodeOf.get(e.id)
    if (!id || !owner) continue
    const creates =
      e.hookName === 'TaskCreated' ||
      (e.hookName === 'PostToolUse' && e.payload?.tool_name === 'TaskCreate')
    // Creation wins; otherwise the first node to touch it (created before capture).
    if (creates || !origin.has(id)) origin.set(id, owner.id)
    windowCap.set(id, owner.endedAt ?? Infinity)
  }
  return { tasks, origin, windowCap, mainEvents, subagents }
}

export interface ContinuedTask {
  step: PlanStep
  /** Node that owns the task (open it to see the whole plan). */
  originId: string
}

export function buildPlan(
  node: TurnNode,
  replies: Array<{ timestamp: number; text: string }> = [],
  session?: SessionPlanContext,
): Plan & { continued: ContinuedTask[] } {
  const events = allEvents(node)
  let source: Plan['source'] = 'tasks'
  let continued: ContinuedTask[] = []
  let steps: PlanStep[]
  if (session) {
    // Tasks this node created, with their status from the whole session.
    steps = [...session.tasks.values()]
      .filter((s) => session.origin.get(s.id) === node.id)
      .map((s) => ({ ...s, subagents: [] }))
    const touched = new Set(node.events.map(taskIdOf).filter((id): id is string => !!id))
    continued = [...touched]
      .filter((id) => session.origin.has(id) && session.origin.get(id) !== node.id)
      .map((id) => ({ step: session.tasks.get(id)!, originId: session.origin.get(id)! }))
      .filter((c) => c.step)
  } else {
    steps = fromTasks(events)
  }
  if (steps.length === 0) {
    source = 'todos'
    steps = fromTodos(events)
  }
  if (steps.length === 0 && replies.length > 0) {
    source = 'replies'
    steps = fromReplies(node, replies)
  }
  if (steps.length === 0) source = 'none'

  const unassigned: Plan['unassigned'] = { toolCount: 0, errorCount: 0, subagents: [] }
  const crossPrompt = !!session && source === 'tasks'
  if (crossPrompt) {
    // A task's work can happen in any prompt: count the session's main-agent
    // tools and subagents inside each step's window. An unfinished step's
    // window stops at the end of the prompt that last touched it, so a task
    // left in_progress doesn't swallow everything after it.
    const windows = steps.map((s) => ({
      ...s,
      endedAt: s.endedAt ?? session!.windowCap.get(s.id) ?? Infinity,
    }))
    const continuedWindows = continued.map((c) => ({
      ...c.step,
      endedAt: c.step.endedAt ?? session!.windowCap.get(c.step.id) ?? Infinity,
    }))
    const own = new Set(node.events.map((e) => e.id))
    for (const e of session!.mainEvents) {
      const tool = e.payload?.tool_name
      if (typeof tool === 'string' && TASK_TOOLS.has(tool)) continue
      const i = stepAt(windows, e.timestamp)
      if (i !== -1) {
        if (e.hookName === 'PreToolUse') steps[i].toolCount++
        if (e.hookName === 'PostToolUseFailure') steps[i].errorCount++
      } else if (own.has(e.id) && stepAt(continuedWindows, e.timestamp) === -1) {
        if (e.hookName === 'PreToolUse') unassigned.toolCount++
        if (e.hookName === 'PostToolUseFailure') unassigned.errorCount++
      }
    }
    const ownChildren = new Set(node.children)
    for (const sub of session!.subagents) {
      const i = stepAt(windows, sub.startedAt)
      if (i !== -1) steps[i].subagents.push(sub)
      else if (ownChildren.has(sub) && stepAt(continuedWindows, sub.startedAt) === -1) {
        unassigned.subagents.push(sub)
      }
    }
  } else {
    // Work inside a continued task's window belongs to that task's own plan.
    const continuedWindows = continued.map((c) => ({
      ...c.step,
      endedAt: c.step.endedAt ?? session?.windowCap.get(c.step.id) ?? Infinity,
    }))
    const inContinued = (ts: number) => stepAt(continuedWindows, ts) !== -1
    // Main-agent tool calls only — a subagent's own tools count toward that subagent.
    for (const e of node.events) {
      const tool = e.payload?.tool_name
      if (typeof tool === 'string' && TASK_TOOLS.has(tool)) continue
      const i = stepAt(steps, e.timestamp)
      if (i === -1 && inContinued(e.timestamp)) continue
      const bucket = i === -1 ? unassigned : steps[i]
      if (e.hookName === 'PreToolUse') bucket.toolCount++
      if (e.hookName === 'PostToolUseFailure') bucket.errorCount++
    }
    for (const child of node.children) {
      const i = stepAt(steps, child.startedAt)
      if (i === -1 && inContinued(child.startedAt)) continue
      ;(i === -1 ? unassigned : steps[i]).subagents.push(child)
    }
  }

  const completed = steps.filter((s) => s.status === 'completed').length
  const known = source === 'tasks' || source === 'todos'
  return {
    source,
    steps,
    unassigned,
    completed,
    total: steps.length,
    progress: known && steps.length > 0 ? completed / steps.length : null,
    continued,
  }
}
