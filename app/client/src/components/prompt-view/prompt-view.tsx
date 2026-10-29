import { useMemo, useState } from 'react'
import { Bot, MessageSquare, Settings2 } from 'lucide-react'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { EventStream } from '@/components/event-stream/event-stream'
import { buildTurnTree, type TurnNode } from '@/lib/turn-tree'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { TurnTreePanel, nodeMeta, nodeTitle, statusLabel } from './turn-tree-panel'

function findNode(nodes: TurnNode[], id: string): TurnNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return null
}

function latestPrompt(roots: TurnNode[]): TurnNode | null {
  for (let i = roots.length - 1; i >= 0; i--) if (roots[i].kind === 'prompt') return roots[i]
  return roots[roots.length - 1] ?? null
}

/**
 * Prompt view: the session as a tree of prompts and the subagents they
 * spawned (left), and the selected node's own events (right). With no
 * explicit selection it follows the latest prompt, so a live session
 * keeps showing the work in progress.
 */
export function PromptView({ sessionId }: { sessionId: string }) {
  const { data: rawEvents } = useEffectiveEvents(sessionId)
  const roots = useMemo(() => buildTurnTree(rawEvents ?? [], { sessionId }), [rawEvents, sessionId])

  // null = follow the latest prompt.
  const [pickedId, setPickedId] = useState<string | null>(null)
  const latest = latestPrompt(roots)
  const selected = (pickedId && findNode(roots, pickedId)) || latest
  const onSelect = (id: string) => setPickedId(id === latest?.id ? null : id)

  const eventIds = useMemo(
    () => (selected ? new Set(selected.events.map((e) => e.id)) : new Set<number>()),
    [selected],
  )

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-border">
        <TurnTreePanel roots={roots} selectedId={selected?.id ?? null} onSelect={onSelect} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected && <NodeHeader node={selected} following={pickedId === null} />}
        <EventStream key={sessionId} onlyEventIds={eventIds} />
      </div>
    </div>
  )
}

function NodeHeader({ node, following }: { node: TurnNode; following: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = node.kind === 'prompt' ? MessageSquare : node.kind === 'subagent' ? Bot : Settings2
  const body = node.kind === 'system' ? null : node.prompt
  const long = !!body && (body.length > 240 || body.includes('\n'))
  return (
    <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            node.kind === 'subagent' ? 'text-violet-500' : 'text-muted-foreground',
          )}
        />
        <span className="truncate font-medium">{nodeTitle(node)}</span>
        {node.agentType && node.kind === 'subagent' && (
          <span className="shrink-0 rounded bg-violet-500/10 px-1 text-[10px] text-violet-600 dark:text-violet-400">
            {node.agentType}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {node.kind !== 'system' && `${statusLabel(node.status)} · `}
          {nodeMeta(node, Date.now())}
          {following && node.kind === 'prompt' && ` · ${t('following latest')}`}
        </span>
      </div>
      {body && (
        <div className="mt-1.5">
          <div
            className={cn(
              'whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1.5 text-muted-foreground',
              !expanded && 'max-h-16 overflow-hidden',
            )}
          >
            {body}
          </div>
          {long && (
            <button
              type="button"
              className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t('Show less') : t('Show full prompt')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
