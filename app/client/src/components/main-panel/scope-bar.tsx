import { useUIStore } from '@/stores/ui-store'
import { useSessionScope } from '@/components/main-panel/session-scope'
import { Button } from '@/components/ui/button'
import { LogsModal } from './logs-modal'
import { AgentCombobox } from './agent-combobox'
import {
  ArrowDownToLine,
  SquarePen,
  BarChart3,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  List,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

export function ScopeBar() {
  const { sessionId: selectedSessionId, pane } = useSessionScope()
  const {
    autoFollow,
    setAutoFollow,
    expandedEventIds,
    collapseAllEvents,
    requestExpandAll,
    setEditingSessionId,
    streamView,
    setStreamView,
  } = useUIStore()

  // Only a selected session is required. Unassigned sessions route as
  // `#/_/<sessionId>` with no project, so selectedProjectId is null — gating
  // on it here hid the whole bar (agent combobox + session icons) on those
  // sessions. The bar's contents only depend on the session.
  if (!selectedSessionId) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border min-h-[40px]">
      <AgentCombobox />

      {/* View mode: prompt tree vs flat raw stream */}
      <div className="flex shrink-0 rounded-md border border-border p-0.5">
        {(
          [
            ['prompts', ListTree, t('Prompts')],
            ['raw', List, t('Raw')],
          ] as const
        ).map(([view, Icon, label]) => (
          <button
            key={view}
            type="button"
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-xs cursor-pointer transition-colors',
              streamView === view
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setStreamView(view)}
            title={
              view === 'prompts'
                ? t('Group events by prompt and subagent')
                : t('Show every event in order')
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Follow */}
        <Button
          variant={autoFollow ? 'default' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setAutoFollow(!autoFollow)}
          title={autoFollow ? t('Auto-follow enabled') : t('Auto-follow disabled')}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </Button>
        {/* Expand/Collapse — the expand-all signal is global, so a compare
            pane hides it rather than expanding both panes at once. */}
        {!pane && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (expandedEventIds.size > 0) {
                collapseAllEvents()
              } else {
                requestExpandAll()
              }
            }}
            title={expandedEventIds.size > 0 ? t('Collapse all') : t('Expand all')}
          >
            {expandedEventIds.size > 0 ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {/* Logs */}
        <LogsModal />
        {/* Stats */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setEditingSessionId(selectedSessionId, 'stats')}
          title={t('Session stats')}
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </Button>
        {/* Edit */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setEditingSessionId(selectedSessionId)}
          title={t('Edit session')}
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
