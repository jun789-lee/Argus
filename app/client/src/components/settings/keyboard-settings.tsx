import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 text-[10px] font-mono font-medium',
        'rounded border border-border bg-muted text-foreground/80',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

function Row({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">{keys}</div>
      <div className="text-xs text-muted-foreground self-center">{label}</div>
    </>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-1">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground mb-3">{hint}</p>}
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">{children}</div>
    </div>
  )
}

export function KeyboardSettings() {
  return (
    <div className="space-y-6">
      <Section
        title={t('Region jumps')}
        hint="Press a single key to focus a region. Suppressed when typing in an input or when a modifier key (⌘/Ctrl/Alt) is held."
      >
        <Row
          keys={
            <>
              <Kbd>/</Kbd>
              <span className="text-[10px] text-muted-foreground/60">{t('or')}</span>
              <Kbd>s</Kbd>
            </>
          }
          label={t('Focus search')}
        />
        <Row keys={<Kbd>a</Kbd>} label={t('Open agents combobox')} />
        <Row keys={<Kbd>f</Kbd>} label={t('Focus first filter pill')} />
        <Row keys={<Kbd>b</Kbd>} label={t('Focus sidebar (selected session, or first item)')} />
        <Row keys={<Kbd>e</Kbd>} label={t('Focus event stream')} />
      </Section>

      <Section title={t('Sidebar (when focused)')}>
        <Row
          keys={
            <>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </>
          }
          label={t('Move between visible items (pinned, projects, sessions)')}
        />
        <Row
          keys={
            <>
              <Kbd>Enter</Kbd>
              <span className="text-[10px] text-muted-foreground/60">{t('or')}</span>
              <Kbd>Space</Kbd>
            </>
          }
          label={t('Open the focused session / toggle a project row')}
        />
      </Section>

      <Section title={t('Filters (when a pill is focused)')}>
        <Row
          keys={
            <>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
            </>
          }
          label={t('Move between filter pills (left/right within and across rows)')}
        />
        <Row
          keys={
            <>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </>
          }
          label={t('Jump between the static row and the dynamic tools row')}
        />
        <Row
          keys={
            <>
              <Kbd>Enter</Kbd>
              <span className="text-[10px] text-muted-foreground/60">{t('or')}</span>
              <Kbd>Space</Kbd>
            </>
          }
          label={t('Toggle the focused filter')}
        />
      </Section>

      <Section
        title={t('Event stream scrolling')}
        hint="Active anywhere on the page (except inside text inputs and dialogs)."
      >
        <Row
          keys={
            <>
              <Kbd>⌘</Kbd>
              <Kbd>↑</Kbd>
              <span className="text-[10px] text-muted-foreground/60">{t('or')}</span>
              <Kbd>Home</Kbd>
            </>
          }
          label={t('Scroll to top')}
        />
        <Row
          keys={
            <>
              <Kbd>⌘</Kbd>
              <Kbd>↓</Kbd>
              <span className="text-[10px] text-muted-foreground/60">{t('or')}</span>
              <Kbd>End</Kbd>
            </>
          }
          label={t('Scroll to bottom')}
        />
        <Row keys={<Kbd>PageUp</Kbd>} label={t('Scroll up one page')} />
        <Row keys={<Kbd>PageDown</Kbd>} label={t('Scroll down one page')} />
      </Section>
    </div>
  )
}
