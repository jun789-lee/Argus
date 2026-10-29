import { useQuery } from '@tanstack/react-query'
import { Repeat } from 'lucide-react'
import { api } from '@/lib/api-client'
import { improvement, type LoopRun } from '@/lib/loops'
import { useUIStore } from '@/stores/ui-store'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const NEEDS_HUMAN = new Set(['awaiting_start', 'alert'])

export function loopStateLabel(state: string): string {
  switch (state) {
    case 'preparing':
      return t('Preparing')
    case 'calibrating':
      return t('Checking graders')
    case 'awaiting_start':
      return t('Waiting for start approval')
    case 'working':
      return t('Working')
    case 'checking':
      return t('Scoring')
    case 'judging':
      return t('Judging')
    case 'alert':
      return t('Needs your decision')
    case 'paused':
      return t('Paused')
    case 'finishing':
      return t('Wrapping up')
    case 'finished':
      return t('Finished')
    default:
      return state
  }
}

export function useLoopRuns() {
  return useQuery({
    queryKey: ['loop-runs'],
    queryFn: () => api.getLoopRuns(),
    refetchInterval: 5_000,
  })
}

/**
 * Sidebar list of auto-loop runs (§9.1): runs needing a human answer sit
 * on top, then the rest newest first.
 */
export function LoopList() {
  const { data, isLoading } = useLoopRuns()
  const selected = useUIStore((s) => s.selectedLoopRunId)
  const setSelected = useUIStore((s) => s.setSelectedLoopRunId)

  if (isLoading) return <div className="p-2 text-xs text-muted-foreground">{t('Loading...')}</div>
  if (data === 'unavailable') {
    return (
      <div className="space-y-1 p-2 text-xs text-muted-foreground">
        <div>{t('Loop data is not connected yet.')}</div>
        <div className="text-[10px] text-muted-foreground/70">
          {t('Runs appear here once the server side of the auto-loop (M2) is in place.')}
        </div>
      </div>
    )
  }
  const runs = [...(data ?? [])].sort(
    (a, b) =>
      Number(NEEDS_HUMAN.has(b.state)) - Number(NEEDS_HUMAN.has(a.state)) ||
      b.startedAt - a.startedAt,
  )
  if (runs.length === 0) {
    return <div className="p-2 text-xs text-muted-foreground">{t('No loop runs yet')}</div>
  }
  return (
    <div className="space-y-0.5">
      {runs.map((run) => (
        <LoopRow
          key={run.id}
          run={run}
          selected={run.id === selected}
          onClick={() => setSelected(run.id)}
        />
      ))}
    </div>
  )
}

function LoopRow({
  run,
  selected,
  onClick,
}: {
  run: LoopRun
  selected: boolean
  onClick: () => void
}) {
  const gain = improvement(run)
  const human = NEEDS_HUMAN.has(run.state)
  const live = run.state !== 'finished' && run.endedAt === null
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md px-2 py-1.5 text-left text-xs cursor-pointer',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
        human && 'ring-1 ring-amber-500/60',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Repeat
          className={cn('h-3.5 w-3.5 shrink-0', live ? 'text-green-500' : 'text-muted-foreground')}
        />
        <span className="truncate font-medium">{run.loopName}</span>
        <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
          {run.iterationsMax ? `${run.iterationsDone}/${run.iterationsMax}` : run.iterationsDone}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[10px] text-muted-foreground">
        <span className={cn(human && 'text-amber-600 dark:text-amber-400')}>
          {loopStateLabel(run.state)}
        </span>
        {gain !== null && (
          <span className={cn('tabular-nums', gain >= 0 ? 'text-green-600' : 'text-red-500')}>
            {gain >= 0 ? '▲' : '▼'}
            {Math.abs(gain * 100).toFixed(1)}%
          </span>
        )}
        <span className="ml-auto tabular-nums">${run.costUsd.toFixed(2)}</span>
      </div>
    </button>
  )
}
