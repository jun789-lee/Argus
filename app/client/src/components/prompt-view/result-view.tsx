import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { TurnNode } from '@/lib/turn-tree'
import { formatDuration } from '@/components/settings/session-modal'
import { MarkdownText } from './conversation-view'
import { statusLabel } from './turn-tree-panel'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Result tab for a subagent: the report it handed back to the main agent
 * (from the task-notification, or SubagentStop for foreground agents),
 * with its status and usage. The instruction it was given is in the
 * header above.
 */
export function ResultView({ node }: { node: TurnNode }) {
  const done = node.endedAt !== null
  const failed = node.status === 'failed'
  const usage = node.usage
  const stats = [
    usage?.durationMs != null
      ? formatDuration(usage.durationMs)
      : done
        ? formatDuration(Math.max(0, node.endedAt! - node.startedAt))
        : null,
    usage?.toolUses != null
      ? t('{n} tools', { n: usage.toolUses })
      : t('{n} tools', { n: node.toolCount }),
    usage?.tokens != null ? t('{n} tokens', { n: usage.tokens.toLocaleString() }) : null,
  ].filter(Boolean)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5">
        {failed ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        )}
        <span className="font-medium">{statusLabel(node.status)}</span>
        <span className="text-muted-foreground tabular-nums">· {stats.join(' · ')}</span>
      </div>
      {node.result ? (
        <div
          className={cn(
            'rounded-md border px-3 py-2',
            failed ? 'border-red-500/30 bg-red-500/5' : 'border-violet-500/30 bg-violet-500/5',
          )}
        >
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
            {t('Subagent result')}
          </div>
          <MarkdownText text={node.result} />
        </div>
      ) : (
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-muted-foreground">
          {done
            ? t('This subagent finished without a recorded result.')
            : t('Still working — the result appears here when the subagent finishes.')}
        </div>
      )}
    </div>
  )
}
