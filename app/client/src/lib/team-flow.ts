// The "team" view of a session: the main agent is the manager, each
// prompt is a mission it runs, and subagents are team members it hands
// work to. This module turns the turn tree into
//   - mission cards (one per prompt) for the strip at the top, and
//   - a mission flow: delegations → reports → the manager's decisions →
//     the final output.
// Pure data; the team board renders it.

import type { TurnNode, TurnStatus } from './turn-tree'
import { buildPlan, type SessionPlanContext } from './plan'

export interface Role {
  /** English label (translated in the UI). */
  label: string
  icon: string
}

const ROLES: Record<string, Role> = {
  Explore: { label: 'Researcher', icon: '🔍' },
  Plan: { label: 'Planner', icon: '🗺️' },
  'general-purpose': { label: 'Generalist', icon: '🧑‍💻' },
  'web-fetch': { label: 'Web reader', icon: '🌐' },
  'claude-code-guide': { label: 'Guide', icon: '📘' },
  'statusline-setup': { label: 'Setup', icon: '🛠️' },
  claude: { label: 'Assistant', icon: '🤖' },
}

/** Team role for a subagent type; unknown (custom) types keep their name. */
export function roleOf(agentType: string | null): Role {
  if (agentType && ROLES[agentType]) return ROLES[agentType]
  return { label: agentType || 'Subagent', icon: '🤖' }
}

export const MANAGER_ROLE: Role = { label: 'Manager', icon: '👔' }

function firstLine(s: string | null | undefined, max = 90): string | null {
  if (!s) return null
  // Prefer the first body line; fall back to a heading when that's all there is.
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[-|:#\s]+$/.test(l))
  const line = lines.find((l) => !l.startsWith('#')) ?? lines[0] ?? ''
  const clean = line
    .replace(/^[#>*\-\s]+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// ---- Missions -------------------------------------------------------------

export interface MissionCard {
  node: TurnNode
  status: TurnStatus
  /** Plan progress 0–1 when the mission keeps a task list. */
  progress: number | null
  done: number
  total: number
  /** Subagents involved (all depths). */
  members: number
  /** Ids of earlier missions whose planned steps this one carried on. */
  continuesFrom: string[]
}

function countMembers(n: TurnNode): number {
  return n.children.reduce((sum, c) => sum + 1 + countMembers(c), 0)
}

export function buildMissions(roots: TurnNode[], session?: SessionPlanContext): MissionCard[] {
  return roots
    .filter((n) => n.kind === 'prompt')
    .map((node) => {
      const plan = buildPlan(node, [], session)
      return {
        node,
        status: node.status,
        progress: plan.progress,
        done: plan.completed,
        total: plan.total,
        members: countMembers(node),
        continuesFrom: [...new Set(plan.continued.map((c) => c.originId))].filter(
          (id) => id !== node.id,
        ),
      }
    })
}

// ---- Mission flow ---------------------------------------------------------

export interface MemberCard {
  node: TurnNode
  role: Role
  /** What it was asked to do. */
  task: string
  /** One-line summary of its report, once it has one. */
  report: string | null
  /** 1 for direct reports, 2+ for subagents spawned by subagents. */
  depth: number
}

export interface DecisionCard {
  timestamp: number
  /** One-line gist of the manager's reply. */
  summary: string
  text: string
}

export interface MissionFlow {
  manager: TurnNode
  members: MemberCard[]
  /** Manager replies after team reports came in (or its own notes when it worked alone). */
  decisions: DecisionCard[]
  output: string | null
}

/**
 * @param replies the manager's text replies for this mission (transcript)
 * @param output  the mission's final answer, once finished
 */
export function buildMissionFlow(
  mission: TurnNode,
  replies: Array<{ timestamp: number; text: string }>,
  output: string | null,
  maxDecisions = 4,
): MissionFlow {
  const members: MemberCard[] = []
  const walk = (n: TurnNode, depth: number) => {
    for (const c of n.children) {
      members.push({
        node: c,
        role: roleOf(c.agentType),
        task: c.title || roleOf(c.agentType).label,
        report: firstLine(c.result),
        depth,
      })
      walk(c, depth + 1)
    }
  }
  walk(mission, 1)

  // Decisions start once the first report is in; a mission without a team
  // shows the manager's own progress notes instead.
  const firstReport = members
    .filter((m) => m.node.endedAt !== null)
    .reduce((min, m) => Math.min(min, m.node.endedAt!), Infinity)
  const from = members.length > 0 && Number.isFinite(firstReport) ? firstReport : -Infinity
  const finalText = output?.trim()
  const decisions = replies
    .filter((r) => r.timestamp >= from && r.text.trim() !== finalText)
    .map((r) => ({ timestamp: r.timestamp, summary: firstLine(r.text) ?? '', text: r.text }))
    .filter((d) => d.summary)
    .slice(-maxDecisions)

  return { manager: mission, members, decisions, output }
}
