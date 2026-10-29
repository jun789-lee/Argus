// The shared "cycle" model behind the ring visual: every piece of work is
// a loop of plan → execute → evaluate → decide. An ordinary mission (one
// prompt) is a single lap; an auto-loop run (see loops.ts) is many laps
// with a score per lap. The ring only needs this model, so both kinds of
// work draw the same picture.

import type { TreeEvent, TurnNode } from './turn-tree'
import type { Plan } from './plan'
import type { MissionFlow, Role } from './team-flow'

export type StageKey = 'plan' | 'execute' | 'evaluate' | 'decide'
export const STAGES: StageKey[] = ['plan', 'execute', 'evaluate', 'decide']

/** idle: not reached · active: happening now · done · skipped: never happened (dimmed). */
export type StageStatus = 'idle' | 'active' | 'done' | 'skipped'

export interface StageItem {
  id: string
  label: string
  detail?: string | null
  state?: 'running' | 'done' | 'failed' | 'pending'
  icon?: string
  /** Turn node to open (prompt or subagent). */
  nodeId?: string
}

export interface StageState {
  status: StageStatus
  items: StageItem[]
  /** Inferred from heuristics rather than recorded explicitly. */
  estimated?: boolean
}

export interface LapScore {
  value: number
  kind: 'accepted' | 'rejected' | 'bug'
}

export interface CycleModel {
  stages: Record<StageKey, StageState>
  /** The stage happening now, null when the work is over. */
  current: StageKey | null
  lap: number
  /** Total laps when known (budget), null otherwise. */
  laps: number | null
  scores: LapScore[]
  /** Change of the latest accepted score vs. the baseline, as a fraction. */
  delta: number | null
  /** Plan progress 0–1 when there is a task list. */
  progress: number | null
  /** Roles shown inside the execute node. */
  team: Role[]
}

// ---- Evaluation heuristics (ordinary missions) -------------------------

const EVAL_COMMAND =
  /\b(test|tests|vitest|pytest|jest|mocha|tsc|lint|eslint|build|check|verify|validate)\b/i
const EVAL_TITLE = /(검증|테스트|평가|확인|review|verify|validat|test|check|evaluat)/i
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

function commandOf(e: TreeEvent): string | null {
  const cmd = (e.payload?.tool_input as Record<string, unknown> | undefined)?.command
  return typeof cmd === 'string' ? cmd : null
}

/** A main-agent tool call that checks work (tests, builds, type checks…). */
export function isEvalEvent(e: TreeEvent): boolean {
  if (e.hookName !== 'PreToolUse') return false
  const tool = e.payload?.tool_name
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  const cmd = commandOf(e)
  return !!cmd && EVAL_COMMAND.test(cmd)
}

function shortCommand(cmd: string): string {
  const one = cmd.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 59)}…` : one
}

// ---- Ordinary mission → cycle ------------------------------------------

export function cycleFromMission(mission: TurnNode, flow: MissionFlow, plan: Plan): CycleModel {
  const running =
    mission.status === 'running' || mission.status === 'waiting' || mission.status === 'background'
  const failedUseIds = new Set(
    mission.events
      .filter((e) => e.hookName === 'PostToolUseFailure')
      .map((e) => e.payload?.tool_use_id),
  )

  // Plan: the task list, or nothing recorded.
  const planItems: StageItem[] =
    plan.source === 'tasks' || plan.source === 'todos'
      ? plan.steps.map((s) => ({
          id: `step-${s.id}`,
          label: s.title,
          state:
            s.status === 'completed' ? 'done' : s.status === 'in_progress' ? 'running' : 'pending',
        }))
      : []

  // Execute: delegated members, plus the manager's own tool work.
  const evalEvents = mission.events.filter(isEvalEvent)
  const workTools = mission.events.filter((e) => {
    if (e.hookName !== 'PreToolUse' || isEvalEvent(e)) return false
    const tool = e.payload?.tool_name
    return !(typeof tool === 'string' && (TASK_TOOLS.has(tool) || tool === 'Agent'))
  })
  const memberItems: StageItem[] = flow.members
    .filter((m) => !EVAL_TITLE.test(m.task))
    .map((m) => ({
      id: m.node.id,
      label: m.task,
      detail: m.report,
      icon: m.role.icon,
      nodeId: m.node.id,
      state: m.node.status === 'failed' ? 'failed' : m.node.endedAt === null ? 'running' : 'done',
    }))
  const executeItems: StageItem[] = [...memberItems]
  if (workTools.length > 0) {
    executeItems.push({
      id: 'manager-tools',
      label: `${workTools.length}`,
      detail: null,
      icon: '🛠️',
      nodeId: mission.id,
    })
  }

  // Evaluate: check commands and review-like members (inferred).
  const evalMembers: StageItem[] = flow.members
    .filter((m) => EVAL_TITLE.test(m.task))
    .map((m) => ({
      id: m.node.id,
      label: m.task,
      detail: m.report,
      icon: m.role.icon,
      nodeId: m.node.id,
      state: m.node.status === 'failed' ? 'failed' : m.node.endedAt === null ? 'running' : 'done',
    }))
  const evalItems: StageItem[] = [
    ...evalMembers,
    ...evalEvents.slice(-4).map((e) => ({
      id: `eval-${e.id}`,
      label: shortCommand(commandOf(e) ?? ''),
      state: (failedUseIds.has(e.payload?.tool_use_id) ? 'failed' : 'done') as StageItem['state'],
      nodeId: mission.id,
    })),
  ]

  // Decide: the manager's decisions and the final answer.
  const decideItems: StageItem[] = flow.decisions.map((d) => ({
    id: `decision-${d.timestamp}`,
    label: d.summary,
    icon: '💡',
    nodeId: mission.id,
  }))
  if (flow.output) {
    decideItems.push({
      id: 'output',
      label: flow.output,
      icon: '📦',
      nodeId: mission.id,
      state: 'done',
    })
  }

  // Which stage is happening now: follow the latest signal.
  let current: StageKey | null = null
  if (running) {
    const lastTool = [...mission.events].reverse().find((e) => e.hookName === 'PreToolUse')
    const lastDecision = flow.decisions[flow.decisions.length - 1]?.timestamp ?? -Infinity
    const membersRunning = flow.members.some((m) => m.node.endedAt === null)
    if (membersRunning || mission.status === 'background') current = 'execute'
    else if (lastDecision > (lastTool?.timestamp ?? -Infinity)) current = 'decide'
    else if (!lastTool) current = 'plan'
    else if (isEvalEvent(lastTool)) current = 'evaluate'
    else {
      const tool = lastTool.payload?.tool_name
      current =
        typeof tool === 'string' && TASK_TOOLS.has(tool) && executeItems.length === 0
          ? 'plan'
          : 'execute'
    }
  }

  const order = (k: StageKey) => STAGES.indexOf(k)
  const statusOf = (k: StageKey, hasItems: boolean, canSkip: boolean): StageStatus => {
    if (current === k) return 'active'
    if (!running) return hasItems ? 'done' : canSkip ? 'skipped' : 'done'
    if (current !== null && order(k) < order(current))
      return hasItems || !canSkip ? 'done' : 'skipped'
    return hasItems ? 'done' : 'idle'
  }

  return {
    stages: {
      plan: { status: statusOf('plan', planItems.length > 0, true), items: planItems },
      execute: { status: statusOf('execute', executeItems.length > 0, false), items: executeItems },
      evaluate: {
        status: statusOf('evaluate', evalItems.length > 0, true),
        items: evalItems,
        estimated: true,
      },
      decide: {
        status: flow.output ? 'done' : statusOf('decide', decideItems.length > 0, false),
        items: decideItems,
      },
    },
    current,
    lap: 1,
    laps: 1,
    scores: [],
    delta: null,
    progress: plan.progress,
    team: flow.members.map((m) => m.role),
  }
}
