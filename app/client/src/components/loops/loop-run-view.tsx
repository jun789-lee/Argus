import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Columns2, ExternalLink, Square } from 'lucide-react'
import { api } from '@/lib/api-client'
import { cycleFromRun, improvement, type LoopGate, type LoopIteration } from '@/lib/loops'
import type { StageKey } from '@/lib/cycle'
import { CycleRing, Sparkline } from '@/components/cycle/cycle-ring'
import { useUIStore } from '@/stores/ui-store'
import { formatDuration } from '@/components/settings/session-modal'
import { loopStateLabel, NEEDS_HUMAN } from './loop-list'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Choices per gate kind (design §8); the value is what the server receives. */
const GATE_CHOICES: Record<string, Array<[string, string]>> = {
  start: [
    ['start', 'Start'],
    ['cancel', 'Cancel'],
  ],
  alert: [
    ['continue', 'Continue'],
    ['reject', 'Reject this iteration and continue'],
    ['stop', 'Stop'],
  ],
  budget: [
    ['extend', 'Extend'],
    ['finish', 'Wrap up'],
  ],
  review: [['ack', 'Got it']],
}

const GATE_TITLE: Record<string, string> = {
  start: 'Approve the start',
  alert: 'Alert: your decision is needed',
  budget: 'Budget used up',
  review: 'Review the result',
}

/**
 * One auto-loop run (§9.2): the loop ring with the current phase and laps,
 * the score trend, pending human checks, and the iteration table linking
 * each iteration to its worker session and to the compare view.
 */
export function LoopRunView({ runId }: { runId: string }) {
  const queryClient = useQueryClient()
  const setSelectedLoopRunId = useUIStore((s) => s.setSelectedLoopRunId)
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId)
  const openCompare = useUIStore((s) => s.openCompare)
  const { data, isLoading } = useQuery({
    queryKey: ['loop-run', runId],
    queryFn: () => api.getLoopRun(runId),
    refetchInterval: (q) => {
      const d = q.state.data
      return d && d !== 'unavailable' && d.run.state === 'finished' ? false : 3_000
    },
  })
  const cycle = useMemo(() => (data && data !== 'unavailable' ? cycleFromRun(data) : null), [data])
  const [stage, setStage] = useState<StageKey | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  const back = () => setSelectedLoopRunId(null)
  const openSession = (sessionId: string) => {
    setSelectedLoopRunId(null)
    setSelectedSessionId(sessionId)
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['loop-run', runId] })

  if (isLoading) {
    return <div className="flex-1 p-4 text-xs text-muted-foreground">{t('Loading...')}</div>
  }
  if (!data || data === 'unavailable' || !cycle) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <div>{t('Loop data is not connected yet.')}</div>
        <button type="button" onClick={back} className="underline cursor-pointer">
          {t('Back to dashboard')}
        </button>
      </div>
    )
  }

  const { run, iterations, gates } = data
  const finished = run.state === 'finished' || run.endedAt !== null
  const gain = improvement(run)
  const pending = gates.filter((g) => g.state === 'pending')
  const bestSession = iterations.find((i) => i.n === run.bestIteration)?.sessionId ?? null
  const sorted = [...iterations].sort((a, b) => b.n - a.n)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Status line */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <button
          type="button"
          onClick={back}
          title={t('Back to dashboard')}
          className="cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="font-semibold">{run.loopName}</span>
        <span
          className={cn(
            'rounded px-1.5 py-px text-[10px]',
            NEEDS_HUMAN.has(run.state)
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {loopStateLabel(run.state)}
        </span>
        {run.terminalReason && (
          <span className="text-muted-foreground">· {run.terminalReason}</span>
        )}
        <span className="ml-auto flex items-center gap-3 tabular-nums text-muted-foreground">
          <span>
            {t('Iterations')}{' '}
            {run.iterationsMax ? `${run.iterationsDone}/${run.iterationsMax}` : run.iterationsDone}
          </span>
          <span>${run.costUsd.toFixed(2)}</span>
          <span>{formatDuration(Math.max(0, (run.endedAt ?? Date.now()) - run.startedAt))}</span>
        </span>
        {!finished &&
          (confirmStop ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="rounded bg-red-500 px-2 py-0.5 text-white cursor-pointer"
                onClick={async () => {
                  await api.stopLoopRun(run.id)
                  setConfirmStop(false)
                  refresh()
                }}
              >
                {t('Stop the loop')}
              </button>
              <button
                type="button"
                className="px-1 text-muted-foreground cursor-pointer"
                onClick={() => setConfirmStop(false)}
              >
                {t('Cancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-border px-2 py-0.5 cursor-pointer hover:bg-accent"
              onClick={() => setConfirmStop(true)}
            >
              <Square className="h-3 w-3" /> {t('Stop')}
            </button>
          ))}
      </div>

      {/* Ring + score trend + pending checks */}
      <div className="flex shrink-0 flex-wrap items-start gap-4 px-3 py-3">
        <CycleRing
          cycle={cycle}
          selected={stage ?? cycle.current}
          onSelect={setStage}
          className="w-[260px]"
        />
        <div className="flex min-w-[16rem] flex-1 flex-col gap-2">
          <div className="text-xs">
            <span className="text-muted-foreground">{t('Best vs baseline')}: </span>
            <span className="font-medium tabular-nums">
              {run.bestScore ?? '—'} / {run.baselineScore ?? '—'}
            </span>
            {gain !== null && (
              <span
                className={cn('ml-1.5 tabular-nums', gain >= 0 ? 'text-green-600' : 'text-red-500')}
              >
                {gain >= 0 ? '▲' : '▼'}
                {Math.abs(gain * 100).toFixed(1)}%
              </span>
            )}
          </div>
          {cycle.scores.length > 1 && <Sparkline scores={cycle.scores} width={320} height={60} />}
          {pending.map((g) => (
            <GateCard key={g.id} gate={g} onDecided={refresh} />
          ))}
        </div>
      </div>

      {/* Iteration table */}
      <div className="px-3 pb-4">
        <table className="w-full text-[11px]">
          <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="pr-2">{t('Operator')}</th>
              <th className="pr-2">{t('Hypothesis')}</th>
              <th className="pr-2">{t('Verdict')}</th>
              <th className="pr-2 text-right">{t('Score')}</th>
              <th className="pr-2 text-right">{t('Change')}</th>
              <th className="pr-2 text-right">{t('Cost')}</th>
              <th className="pr-2 text-right">{t('Duration')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((it) => (
              <IterationRow
                key={it.n}
                it={it}
                isBest={it.n === run.bestIteration}
                bestSession={bestSession}
                onOpen={openSession}
                onCompare={(a, b) => {
                  setSelectedLoopRunId(null)
                  openCompare([a, b])
                }}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3 text-center text-muted-foreground">
                  {t('No iterations yet')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IterationRow({
  it,
  isBest,
  bestSession,
  onOpen,
  onCompare,
}: {
  it: LoopIteration
  isBest: boolean
  bestSession: string | null
  onOpen: (sessionId: string) => void
  onCompare: (a: string, b: string) => void
}) {
  const running = it.verdict === null
  return (
    <tr className={cn('border-t border-border/50', isBest && 'bg-green-500/5')}>
      <td className="py-1 pr-2 tabular-nums">
        {it.n}
        {isBest && ' ★'}
      </td>
      <td className="pr-2 text-muted-foreground">{it.operator ?? '—'}</td>
      <td className="max-w-[24rem] truncate pr-2" title={it.hypothesis ?? undefined}>
        {it.hypothesis ?? '—'}
      </td>
      <td className="pr-2">
        {running ? (
          <span className="text-green-600">● {t('Running')}</span>
        ) : it.verdict === 'accepted' ? (
          <span className="text-green-600">✅ {it.verdict}</span>
        ) : (
          <span className="text-muted-foreground">{it.verdict}</span>
        )}
      </td>
      <td className="pr-2 text-right tabular-nums">{it.score ?? '—'}</td>
      <td className="pr-2 text-right tabular-nums">
        {it.delta != null ? `${it.delta > 0 ? '+' : ''}${it.delta}` : '—'}
        {it.deltaSe != null && <span className="text-muted-foreground"> ±{it.deltaSe}</span>}
      </td>
      <td className="pr-2 text-right tabular-nums">
        {it.costUsd != null ? `$${it.costUsd.toFixed(2)}` : '—'}
      </td>
      <td className="pr-2 text-right tabular-nums">
        {it.durationS != null ? formatDuration(it.durationS * 1000) : '—'}
      </td>
      <td className="whitespace-nowrap text-right">
        {it.sessionId && (
          <button
            type="button"
            title={t('Open the worker session')}
            className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => onOpen(it.sessionId!)}
          >
            <ExternalLink className="inline h-3 w-3" />
          </button>
        )}
        {it.sessionId && bestSession && bestSession !== it.sessionId && (
          <button
            type="button"
            title={t('Compare with the best')}
            className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => onCompare(it.sessionId!, bestSession)}
          >
            <Columns2 className="inline h-3 w-3" />
          </button>
        )}
      </td>
    </tr>
  )
}

function GateCard({ gate, onDecided }: { gate: LoopGate; onDecided: () => void }) {
  const [busy, setBusy] = useState(false)
  const choices = GATE_CHOICES[gate.kind] ?? [['continue', 'Continue']]
  const reason = typeof gate.request?.reason === 'string' ? gate.request.reason : null
  return (
    <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="font-medium text-amber-700 dark:text-amber-300">
        ✋ {t(GATE_TITLE[gate.kind] ?? gate.kind)}
      </div>
      {reason && <div className="mt-1 text-muted-foreground">{reason}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {choices.map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.decideLoopGate(gate.id, value)
                onDecided()
              } finally {
                setBusy(false)
              }
            }}
            className={cn(
              'rounded border px-2 py-0.5 cursor-pointer disabled:opacity-50',
              value === 'stop' || value === 'cancel'
                ? 'border-red-500/50 text-red-600 hover:bg-red-500/10'
                : 'border-border hover:bg-accent',
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  )
}
