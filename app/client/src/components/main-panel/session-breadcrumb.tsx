import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CircleUser, Folder, X } from 'lucide-react'
import { formatAccount, getSessionAccounts } from '@/lib/session-account'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { useSessionScope, COMPARE_PANE_STYLES } from './session-scope'
import { useEvents } from '@/hooks/use-events'
import { CopyButton } from '@/components/shared/copy-button'
import { CacheCountdown } from './cache-countdown'
import { t } from '@/lib/i18n'

export function SessionBreadcrumb() {
  const { selectedProjectId, setSelectedSessionId, dedupEnabled, openSettings } = useUIStore()
  const closeComparePane = useUIStore((s) => s.closeComparePane)
  const { sessionId: selectedSessionId, pane } = useSessionScope()
  const paneStyle = pane ? COMPARE_PANE_STYLES[pane.index] : null

  const { data: session } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: 30_000,
  })

  const { data: events } = useEvents(selectedSessionId)

  // Render as soon as we have the session — an unassigned session (no project)
  // is a first-class route (`#/_/<id>`) and still needs its breadcrumb + name.
  if (!selectedSessionId || !session) return null

  // Extract cwd from the first SessionStart event. Per the new wire
  // shape we filter by `hookName` (subtype is derived client-side).
  const sessionStartEvent = events?.find((e) => e.hookName === 'SessionStart')
  const cwd = (sessionStartEvent?.payload as Record<string, any>)?.cwd as string | undefined

  // No project → the crumb returns to the dashboard rather than a project page.
  const hasProject = selectedProjectId != null
  const projectName = session.projectSlug || session.projectName || t('Unassigned')
  const sessionName = session.slug || selectedSessionId.slice(0, 8)
  const transcriptPath = session.transcriptPath || null
  const { current: account, all: accounts } = getSessionAccounts(session.metadata)

  return (
    <div className="group/breadcrumb flex items-center gap-1.5 px-3 py-1 border-b border-border text-xs text-muted-foreground min-h-[28px]">
      {paneStyle && (
        <span
          className={`shrink-0 rounded px-1.5 text-[10px] font-semibold ${paneStyle.badge}`}
          title={t('Compare pane {label}', { label: paneStyle.label })}
        >
          {paneStyle.label}
        </span>
      )}
      {pane ? (
        // In a compare pane the project is just context; leaving goes
        // through the pane's close button instead.
        <span className="truncate max-w-[150px]">{projectName}</span>
      ) : (
        <button
          className="hover:text-foreground transition-colors cursor-pointer truncate max-w-[150px]"
          onClick={() => setSelectedSessionId(null)}
          title={hasProject ? t('Back to {name}', { name: projectName }) : t('Back to dashboard')}
        >
          {projectName}
        </button>
      )}
      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
      {transcriptPath ? (
        <CopyButton
          text={transcriptPath}
          label={sessionName}
          title={t('Click to copy: {text}', { text: transcriptPath })}
          className="max-w-[200px] text-foreground"
        />
      ) : (
        <span className="text-foreground truncate max-w-[200px]" title={selectedSessionId}>
          {sessionName}
        </span>
      )}
      {cwd && (
        <>
          <span className="opacity-30 mx-0.5">|</span>
          <CopyButton
            text={cwd}
            label={cwd.split('/').slice(-2).join('/')}
            icon={<Folder className="h-3 w-3 shrink-0" />}
            title={t('Click to copy: {text}', { text: cwd })}
          />
        </>
      )}
      <CacheCountdown sessionId={selectedSessionId} eventCount={events?.length ?? 0} />
      {account && (
        <>
          <span className="opacity-30 mx-0.5">|</span>
          <span
            className="flex items-center gap-1 truncate max-w-[220px]"
            title={accounts.map(formatAccount).join('\n')}
          >
            <CircleUser className="h-3 w-3 shrink-0" />
            <span className="truncate">{account.email}</span>
            {accounts.length > 1 && (
              <span className="shrink-0 opacity-60">
                {t('+{n} more', { n: accounts.length - 1 })}
              </span>
            )}
          </span>
        </>
      )}
      <button
        className={`ml-auto rounded-full px-2 py-0.5 text-[10px] border cursor-pointer transition-colors shrink-0 ${
          dedupEnabled
            ? 'border-border/50 text-muted-foreground/50 hover:border-border hover:text-muted-foreground'
            : 'border-orange-500/50 text-orange-500 hover:border-orange-500 hover:text-orange-600'
        }`}
        onClick={() => openSettings('settings')}
        title={dedupEnabled ? t('Event dedup is on') : t('Event dedup is off — showing raw events')}
      >
        {dedupEnabled ? t('Dedup Events') : t('Raw Events')}
      </button>
      {pane && (
        <button
          className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
          onClick={() => closeComparePane(selectedSessionId)}
          title={t('Close this pane and open the other session')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
