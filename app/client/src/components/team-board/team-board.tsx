import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CornerUpLeft, Lightbulb, Package, Users } from 'lucide-react'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useUIStore } from '@/stores/ui-store'
import { buildTurnTree, type TurnNode, type TurnStatus } from '@/lib/turn-tree'
import { buildSessionPlanContext } from '@/lib/plan'
import {
  MANAGER_ROLE,
  buildMissionFlow,
  buildMissions,
  type MemberCard,
  type MissionCard,
} from '@/lib/team-flow'
import { finalOutput } from '@/components/prompt-view/prompt-view'
import { useAssistantMessages } from '@/components/prompt-view/conversation-view'
import { ProgressBadge } from '@/components/prompt-view/subagent-progress'
import { nodeTitle, statusLabel } from '@/components/prompt-view/turn-tree-panel'
import { formatDuration } from '@/components/settings/session-modal'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STATUS_RING: Record<TurnStatus, string> = {
  running: 'border-green-500',
  waiting: 'border-amber-500',
  background: 'border-violet-500',
  done: 'border-border',
  failed: 'border-red-500',
  interrupted: 'border-dashed border-muted-foreground/40',
}

const STATUS_DOT: Record<TurnStatus, string> = {
  running: 'bg-green-500 animate-pulse',
  waiting: 'bg-amber-500 animate-pulse',
  background: 'bg-violet-500 animate-pulse',
  done: 'bg-muted-foreground/40',
  failed: 'bg-red-500',
  interrupted: 'bg-muted-foreground/20',
}

const isLive = (s: TurnStatus) => s === 'running' || s === 'waiting' || s === 'background'

function findMissionOf(roots: TurnNode[], id: string): TurnNode | null {
  for (const r of roots) {
    if (r.kind !== 'prompt') continue
    if (r.id === id) return r
    const stack = [...r.children]
    while (stack.length) {
      const n = stack.pop()!
      if (n.id === id) return r
      stack.push(...n.children)
    }
  }
  return null
}

/**
 * Team board: the session as a team. The manager (main agent) runs one
 * mission per prompt — the strip on top — and the selected mission is
 * drawn as a flow: who it handed work to, what they reported, what it
 * decided, and what it delivered. Cards open the detailed prompt view.
 */
export function TeamBoard({ sessionId }: { sessionId: string }) {
  const { data: rawEvents } = useEffectiveEvents(sessionId)
  const roots = useMemo(() => buildTurnTree(rawEvents ?? [], { sessionId }), [rawEvents, sessionId])
  const session = useMemo(() => buildSessionPlanContext(roots), [roots])
  const missions = useMemo(() => buildMissions(roots, session), [roots, session])

  const selectedTurn = useUIStore((s) => s.selectedTurn)
  const setSelectedTurn = useUIStore((s) => s.setSelectedTurn)
  const setStreamView = useUIStore((s) => s.setStreamView)
  const picked = selectedTurn?.sessionId === sessionId ? selectedTurn.id : null
  const mission =
    (picked && findMissionOf(roots, picked)) || missions[missions.length - 1]?.node || null

  const open = (id: string) => {
    setSelectedTurn({ sessionId, id })
    setStreamView('prompts')
  }

  if (!mission) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t('No missions yet')}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col gap-2 px-2 py-1.5">
      <MissionStrip missions={missions} selectedId={mission.id} onSelect={open} />
      <MissionFlowView
        key={mission.id}
        sessionId={sessionId}
        mission={mission}
        allEvents={rawEvents ?? []}
        selectedId={picked}
        onOpen={open}
      />
    </div>
  )
}

// ---- Mission strip --------------------------------------------------------

function ProgressRing({ value, status }: { value: number | null; status: TurnStatus }) {
  const r = 7
  const c = 2 * Math.PI * r
  const pct = value ?? (status === 'done' ? 1 : 0)
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0 -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`}
        className={cn(
          status === 'failed'
            ? 'stroke-red-500'
            : isLive(status)
              ? 'stroke-blue-500'
              : 'stroke-green-500',
          value === null && isLive(status) && 'animate-pulse',
        )}
        style={
          value === null && isLive(status) ? { strokeDasharray: `${0.3 * c} ${c}` } : undefined
        }
      />
    </svg>
  )
}

function MissionStrip({
  missions,
  selectedId,
  onSelect,
}: {
  missions: MissionCard[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current
      ?.querySelector(`[data-mission="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])
  return (
    <div ref={ref} className="flex shrink-0 items-stretch gap-1.5 overflow-x-auto pb-1">
      {missions.map((m, i) => (
        <div key={m.node.id} className="flex items-center gap-1.5">
          {i > 0 && (
            <span
              className={cn(
                'text-[10px]',
                m.continuesFrom.length > 0 ? 'text-blue-500' : 'text-muted-foreground/30',
              )}
              title={m.continuesFrom.length > 0 ? t('Continues an earlier mission') : undefined}
            >
              {m.continuesFrom.length > 0 ? <CornerUpLeft className="h-3 w-3" /> : '›'}
            </span>
          )}
          <button
            type="button"
            data-mission={m.node.id}
            onClick={() => onSelect(m.node.id)}
            title={`${nodeTitle(m.node)}\n${statusLabel(m.status)}`}
            className={cn(
              'flex w-44 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] cursor-pointer transition-colors',
              m.node.id === selectedId
                ? 'border-primary bg-primary/5'
                : 'border-border/60 hover:bg-accent/40',
            )}
          >
            <ProgressRing value={m.progress} status={m.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate">{nodeTitle(m.node)}</div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[m.status])} />
                {m.total > 0 ? `${m.done}/${m.total}` : statusLabel(m.status)}
                {m.members > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Users className="h-2.5 w-2.5" />
                    {m.members}
                  </span>
                )}
              </div>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}

// ---- Mission flow ---------------------------------------------------------

function Column({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  )
}

function Arrow() {
  return (
    <div className="flex shrink-0 items-center self-stretch pt-4 text-muted-foreground/40">
      <ArrowRight className="h-3.5 w-3.5" />
    </div>
  )
}

function MissionFlowView({
  sessionId,
  mission,
  allEvents,
  selectedId,
  onOpen,
}: {
  sessionId: string
  mission: TurnNode
  allEvents: Parameters<typeof finalOutput>[1]
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const output = finalOutput(mission, allEvents)
  const replies = useAssistantMessages(sessionId, mission, output)
  const flow = useMemo(
    () => buildMissionFlow(mission, replies ?? [], output),
    [mission, replies, output],
  )

  const live = isLive(mission.status) || flow.members.some((m) => m.node.endedAt === null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live])

  return (
    <div className="flex min-h-0 flex-1 items-start gap-2 overflow-auto">
      <Column label={t('Manager')} className="w-48 shrink-0">
        <button
          type="button"
          onClick={() => onOpen(mission.id)}
          className={cn(
            'rounded-lg border-2 bg-background px-2.5 py-2 text-left text-[11px] cursor-pointer hover:bg-accent/40',
            STATUS_RING[mission.status],
            selectedId === mission.id && 'ring-1 ring-primary',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-base leading-none">{MANAGER_ROLE.icon}</span>
            <span className="font-medium">{t(MANAGER_ROLE.label)}</span>
            <span className={cn('ml-auto h-2 w-2 rounded-full', STATUS_DOT[mission.status])} />
          </div>
          <div className="mt-1 line-clamp-2 text-muted-foreground">{nodeTitle(mission)}</div>
          <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
            {statusLabel(mission.status)} ·{' '}
            {formatDuration(Math.max(0, (mission.endedAt ?? now) - mission.startedAt))}
          </div>
        </button>
      </Column>

      <Arrow />

      <Column label={t('Team (delegated)')} className="w-64 shrink-0">
        {flow.members.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            {t('The manager is working alone on this mission.')}
          </div>
        ) : (
          flow.members.map((m) => (
            <MemberCardView
              key={m.node.id}
              member={m}
              now={now}
              selected={selectedId === m.node.id}
              onOpen={() => onOpen(m.node.id)}
            />
          ))
        )}
      </Column>

      <Arrow />

      <Column label={t('Decisions')} className="w-64 shrink-0">
        {flow.decisions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            {flow.members.length > 0 && flow.members.every((m) => m.node.endedAt === null)
              ? t('Waiting for the team to report.')
              : t('No decisions recorded yet.')}
          </div>
        ) : (
          flow.decisions.map((d) => (
            <button
              key={d.timestamp}
              type="button"
              onClick={() => onOpen(mission.id)}
              title={d.text.slice(0, 600)}
              className="flex gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-left text-[11px] cursor-pointer hover:bg-amber-500/10"
            >
              <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="line-clamp-2">{d.summary}</span>
            </button>
          ))
        )}
      </Column>

      <Arrow />

      <Column label={t('Deliverable')} className="w-56 shrink-0">
        <button
          type="button"
          onClick={() => onOpen(mission.id)}
          title={flow.output?.slice(0, 600)}
          className={cn(
            'flex gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] cursor-pointer',
            flow.output
              ? 'border-green-500/40 bg-green-500/5 hover:bg-green-500/10'
              : 'border-dashed border-border/60 text-muted-foreground',
          )}
        >
          <Package
            className={cn('mt-px h-3.5 w-3.5 shrink-0', flow.output ? 'text-green-600' : '')}
          />
          <span className="line-clamp-3">
            {flow.output
              ? (flow.output.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ??
                flow.output)
              : live
                ? t('In progress…')
                : t('No final answer recorded.')}
          </span>
        </button>
      </Column>
    </div>
  )
}

function MemberCardView({
  member,
  now,
  selected,
  onOpen,
}: {
  member: MemberCard
  now: number
  selected: boolean
  onOpen: () => void
}) {
  const { node, role } = member
  const running = node.endedAt === null
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ marginLeft: (member.depth - 1) * 14 }}
      className={cn(
        'rounded-lg border-2 bg-background px-2.5 py-1.5 text-left text-[11px] cursor-pointer hover:bg-accent/40',
        STATUS_RING[node.status],
        selected && 'ring-1 ring-primary',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{role.icon}</span>
        <span className="font-medium">{t(role.label)}</span>
        {running ? (
          <span className="ml-auto flex items-center gap-1">
            <ProgressBadge node={node} now={now} />
            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[node.status])} />
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {node.endedAt !== null && formatDuration(Math.max(0, node.endedAt - node.startedAt))}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-muted-foreground">{member.task}</div>
      {member.report && (
        <div className="mt-1 flex gap-1 rounded bg-violet-500/5 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
          <span className="shrink-0">📄</span>
          <span className="line-clamp-2">{member.report}</span>
        </div>
      )}
    </button>
  )
}
