import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Timer } from 'lucide-react'
import { api } from '@/lib/api-client'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Countdown to the session's prompt-cache expiry, estimated server-side
 * from the transcript (last response + TTL of the latest cache write).
 * `eventCount` is only a refetch trigger: each new hook event may mean a
 * new API request that reset the TTL.
 */
export function CacheCountdown({
  sessionId,
  eventCount,
}: {
  sessionId: string
  eventCount: number
}) {
  const { data: status, refetch } = useQuery({
    queryKey: ['cache-status', sessionId],
    queryFn: () => api.getCacheStatus(sessionId),
    refetchInterval: 15_000,
  })

  useEffect(() => {
    refetch()
  }, [eventCount, refetch])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!status?.expiresAt || !status.ttlMs || !status.lastRequestAt) return null

  const remaining = status.expiresAt - now
  const expired = remaining <= 0
  const fraction = remaining / status.ttlMs
  const ttlLabel = status.ttlMs >= 60 * 60 * 1000 ? t('1 hour') : t('5 minutes')
  const title = [
    t('Prompt cache TTL: {ttl}', { ttl: ttlLabel }),
    t('Last API response: {time}', { time: new Date(status.lastRequestAt).toLocaleTimeString() }),
    t('Expires: {time}', { time: new Date(status.expiresAt).toLocaleTimeString() }),
    t('Estimated from the transcript; the next request resets the timer.'),
  ].join('\n')

  return (
    <>
      <span className="opacity-30 mx-0.5">|</span>
      <span
        className={cn(
          'flex items-center gap-1 shrink-0 tabular-nums',
          expired
            ? 'text-muted-foreground/50'
            : remaining < 60_000
              ? 'text-red-500 dark:text-red-400'
              : fraction < 0.25
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400',
        )}
        title={title}
      >
        <Timer className="h-3 w-3 shrink-0" />
        {expired ? t('Cache expired') : t('Cache {time}', { time: formatRemaining(remaining) })}
      </span>
    </>
  )
}
