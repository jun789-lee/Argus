import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight, MessageSquareText, Sparkles } from 'lucide-react'
import { api, type AssistantMessage } from '@/lib/api-client'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { mdComponents } from '@/agents/claude-code/event-detail'
import { resolveEventIcon, resolveEventColor } from '@/lib/event-icon-registry'
import { useUIStore } from '@/stores/ui-store'
import type { TurnNode } from '@/lib/turn-tree'
import type { EnrichedEvent } from '@/agents/types'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Hooks represented elsewhere in the conversation (Input / Output cards).
const HIDDEN_HOOKS = new Set(['UserPromptSubmit', 'Stop', 'SubagentStart'])

type Item =
  | { kind: 'text'; ts: number; text: string }
  | { kind: 'activity'; ts: number; events: EnrichedEvent[] }

/**
 * Conversation log for one turn node: Claude's text replies (from the
 * transcript) interleaved in time with collapsible groups of the hook
 * events in between, ending with the final reply as the Output card.
 */
export function ConversationView({
  sessionId,
  node,
  output,
  follow,
  onOpenEvent,
}: {
  sessionId: string
  node: TurnNode
  /** Final reply (Stop / SubagentStop last_assistant_message), if finished. */
  output: string | null
  /** Keep scrolled to the bottom as new items arrive. */
  follow: boolean
  /** Jump to an event in the full log. */
  onOpenEvent: (eventId: number) => void
}) {
  const messages = useAssistantMessages(sessionId, node, output)

  const { events: enriched } = useProcessedEvents()
  const items = useMemo(
    () => buildItems(node, enriched, messages ?? [], output),
    [node, enriched, messages, output],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, items.length, output])

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5">
      {items.map((item, i) =>
        item.kind === 'text' ? (
          <ReplyBubble key={`t${i}`} text={item.text} />
        ) : (
          <ActivityGroup
            key={`a${item.events[0].id}`}
            events={item.events}
            onOpenEvent={onOpenEvent}
          />
        ),
      )}
      {output !== null ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-primary">
            <Sparkles className="h-3 w-3" />
            {t('Final answer')}
          </div>
          <MarkdownText text={output} />
        </div>
      ) : (
        node.kind !== 'system' &&
        node.endedAt === null && (
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            {t('Working…')}
          </div>
        )
      )}
      {items.length === 0 && output === null && node.endedAt !== null && (
        <div className="px-1 text-xs text-muted-foreground">{t('No events')}</div>
      )}
    </div>
  )
}

/** Claude's text replies for a turn node; refetches while the turn is live. */
export function useAssistantMessages(
  sessionId: string,
  node: TurnNode,
  output: string | null,
): AssistantMessage[] | null | undefined {
  const by = node.kind === 'subagent' ? { agentId: node.agentId } : { promptId: node.id }
  const { data, refetch } = useQuery({
    queryKey: ['assistant-messages', sessionId, node.kind, node.id],
    queryFn: () => api.getAssistantMessages(sessionId, by),
    enabled: node.kind !== 'system',
    staleTime: 5_000,
  })
  // New hook events usually mean new transcript entries — refetch while live.
  useEffect(() => {
    if (node.endedAt === null || output === null) refetch()
  }, [node.events.length, node.endedAt, output, refetch])
  return data
}

export function buildItems(
  node: TurnNode,
  enriched: EnrichedEvent[],
  messages: AssistantMessage[],
  output: string | null,
): Item[] {
  const ids = new Set(node.events.map((e) => e.id))
  const events = enriched
    .filter((e) => ids.has(e.id) && e.displayEventStream && !HIDDEN_HOOKS.has(e.hookName))
    .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
  // The final reply is shown as Output; drop its duplicate from the stream.
  const finalText = output?.trim()
  const texts = messages.filter((m) => m.text.trim() !== finalText)

  type Entry = { ts: number; text?: string; event?: EnrichedEvent }
  const merged: Entry[] = [
    ...texts.map((m): Entry => ({ ts: m.timestamp, text: m.text })),
    ...events.map((e): Entry => ({ ts: e.timestamp, event: e })),
  ].sort((a, b) => a.ts - b.ts || (a.text !== undefined ? -1 : 1))

  const items: Item[] = []
  for (const m of merged) {
    if (m.text !== undefined) {
      items.push({ kind: 'text', ts: m.ts, text: m.text })
      continue
    }
    const last = items[items.length - 1]
    if (last?.kind === 'activity') last.events.push(m.event!)
    else items.push({ kind: 'activity', ts: m.ts, events: [m.event!] })
  }
  return items
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="text-xs leading-relaxed break-words [&_table]:my-1.5 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_pre]:overflow-x-auto [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[11px]">
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </Markdown>
    </div>
  )
}

function ReplyBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-muted-foreground [&_strong]:text-foreground">
        <MarkdownText text={text} />
      </div>
    </div>
  )
}

function ActivityGroup({
  events,
  onOpenEvent,
}: {
  events: EnrichedEvent[]
  onOpenEvent: (eventId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const failed = events.filter((e) => e.status === 'failed').length
  // "Read ×3 · Edit · Bash ×2"
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = e.toolName || e.label || e.hookName
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const summary = [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' · ')
  return (
    <div className="ml-5 rounded-md border border-border/60 bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{summary}</span>
        {failed > 0 && (
          <span className="shrink-0 text-red-500">{t('{n} failed', { n: failed })}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 py-0.5">
          {events.map((e) => (
            <EventLine key={e.id} event={e} onOpen={() => onOpenEvent(e.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function EventLine({ event, onOpen }: { event: EnrichedEvent; onOpen: () => void }) {
  const Icon = resolveEventIcon(event.iconId)
  const color = resolveEventColor(event.iconId)
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-accent/50 cursor-pointer"
      onClick={onOpen}
      title={t('Open in log')}
    >
      <Icon
        className={cn('h-3 w-3 shrink-0', color.iconColor)}
        style={color.customHex ? { color: color.customHex } : undefined}
      />
      <span className="shrink-0 font-medium">{event.toolName || event.label}</span>
      <span className="truncate text-muted-foreground">{event.summary}</span>
      {event.status === 'failed' && <span className="ml-auto shrink-0 text-red-500">✗</span>}
    </button>
  )
}

/** Hook for PromptView: jump from the conversation into the full log. */
export function useOpenEventInLog(switchToLog: () => void) {
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)
  const toggleExpandedEvent = useUIStore((s) => s.toggleExpandedEvent)
  const expanded = useUIStore((s) => s.expandedEventIds)
  return (eventId: number) => {
    switchToLog()
    if (!expanded.has(eventId)) toggleExpandedEvent(eventId)
    setScrollToEventId(eventId)
  }
}
