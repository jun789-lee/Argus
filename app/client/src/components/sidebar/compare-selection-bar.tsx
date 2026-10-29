import { Columns2 } from 'lucide-react'
import { useUIStore, MAX_COMPARE_SESSIONS } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

/**
 * Sits above the sidebar footer while sessions are checked for comparison.
 * The compare view only opens from the button here, never just because a
 * second box got checked, so checking boxes never moves the main panel.
 */
export function CompareSelectionBar() {
  const t = useT()
  const selection = useUIStore((s) => s.compareSelection)
  const openCompare = useUIStore((s) => s.openCompare)
  const clearCompareSelection = useUIStore((s) => s.clearCompareSelection)

  if (selection.length === 0) return null
  const ready = selection.length === MAX_COMPARE_SESSIONS

  return (
    <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {ready ? t('{n} selected', { n: selection.length }) : t('Pick one more session to compare')}
      </span>
      {ready && (
        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => openCompare(selection)}>
          <Columns2 className="mr-1 h-3.5 w-3.5" />
          {t('Compare')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => clearCompareSelection()}
      >
        {t('Clear')}
      </Button>
    </div>
  )
}
