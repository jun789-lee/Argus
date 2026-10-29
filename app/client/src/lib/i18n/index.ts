import { create } from 'zustand'
import { format as timeagoFormat, register } from 'timeago.js'
import timeagoKo from 'timeago.js/lib/lang/ko'
import { ko } from './ko'

// Lightweight gettext-style i18n: the English source string is the key, so
// call sites stay readable and any string missing from a dictionary simply
// falls back to English. Placeholders use `{name}` and are filled from `vars`.

export type Lang = 'en' | 'ko'

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
]

const STORAGE_KEY = 'agents-observe-lang'

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, ko }

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'ko') return stored
  } catch {
    // localStorage unavailable — fall through to browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en'
}

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLangStore = create<LangState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // ignore
    }
    document.documentElement.lang = lang
    set({ lang })
  },
}))

export type TVars = Record<string, string | number>

function translate(lang: Lang, key: string, vars?: TVars): string {
  const str = dictionaries[lang][key] ?? key
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
}

/** Non-reactive translate — for toasts, callbacks and other non-render code. */
export function t(key: string, vars?: TVars): string {
  return translate(useLangStore.getState().lang, key, vars)
}

/** Plural-aware translate: picks `one` or `other` by count, `{n}` is filled in. */
export function tn(one: string, other: string, n: number, vars?: TVars): string {
  return t(n === 1 ? one : other, { n, ...vars })
}

/** React hook — re-renders the component when the language changes. */
export function useT(): (key: string, vars?: TVars) => string {
  const lang = useLangStore((s) => s.lang)
  return (key, vars) => translate(lang, key, vars)
}

register('ko', timeagoKo)

/** timeago.js `format` in the current language ("3 minutes ago" / "3분 전"). */
export function timeAgo(ts: number | Date): string {
  const lang = useLangStore.getState().lang
  return timeagoFormat(ts, lang === 'ko' ? 'ko' : 'en_US')
}

/** Compact relative time used in the sidebar ("5m ago" / "5분 전"). */
export function shortTimeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('just now')
  if (mins < 60) return t('{n}m ago', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('{n}h ago', { n: hours })
  return t('{n}d ago', { n: Math.floor(hours / 24) })
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Localize a sidebar date-group label ("Today", "October 2026"). */
export function localizeDateGroup(label: string): string {
  const m = /^(\w+) (\d{4})$/.exec(label)
  if (m && MONTHS.includes(m[1]) && useLangStore.getState().lang === 'ko') {
    return `${m[2]}년 ${MONTHS.indexOf(m[1]) + 1}월`
  }
  return t(label)
}
