import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { t } from '@/lib/i18n'

/**
 * Small centered spinner with optional label.
 * Uses a pure-CSS border spinner promoted to its own compositor layer
 * so it continues animating even when the main thread is blocked by
 * heavy React renders (e.g. processing 10k+ events).
 */
export function Spinner({
  label,
  size = 'md',
  className,
}: {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const px = size === 'sm' ? 12 : size === 'lg' ? 24 : 16
  const border = size === 'sm' ? 1.5 : 2
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 text-muted-foreground text-sm',
        className,
      )}
    >
      <div
        style={{
          width: px,
          height: px,
          border: `${border}px solid currentColor`,
          borderTopColor: 'transparent',
          borderRadius: '50%',
          willChange: 'transform',
          animation: 'spin 1s linear infinite',
          opacity: 0.6,
        }}
      />
      {label && <span>{label}</span>}
    </div>
  )
}

/** Centered empty state with optional icon and hint. */
export function EmptyState({
  text,
  hint,
  icon,
  className,
}: {
  text: string
  hint?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm py-6',
        className,
      )}
    >
      {icon && <div className="opacity-60 mb-1">{icon}</div>}
      <div>{text}</div>
      {hint && <div className="text-xs opacity-70">{hint}</div>}
    </div>
  )
}

/** Centered error state with a message. */
export function ErrorState({ message, className }: { message?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 text-destructive text-sm py-6',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4" />
      <div>{message || t('Something went wrong')}</div>
    </div>
  )
}
