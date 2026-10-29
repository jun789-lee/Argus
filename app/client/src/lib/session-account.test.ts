import { describe, expect, test } from 'vitest'
import { formatAccount, getSessionAccounts } from './session-account'

describe('getSessionAccounts', () => {
  test('handles missing metadata', () => {
    expect(getSessionAccounts(null)).toEqual({ current: null, all: [] })
  })

  test('returns current and history, skipping malformed entries', () => {
    const a = { email: 'a@example.com', firstSeen: 1 }
    const b = { email: 'b@example.com', firstSeen: 2 }
    const r = getSessionAccounts({ account: b, accounts: [a, { nope: 1 }, b] })
    expect(r.current).toEqual(b)
    expect(r.all).toEqual([a, b])
  })

  test('includes current even when history is missing', () => {
    expect(getSessionAccounts({ account: { email: 'a@example.com' } }).all).toHaveLength(1)
  })
})

describe('formatAccount', () => {
  test('appends org unless it repeats the email', () => {
    expect(formatAccount({ email: 'a@x.com', org: 'Acme' })).toBe('a@x.com · Acme')
    expect(formatAccount({ email: 'a@x.com', org: "a@x.com's Organization" })).toBe('a@x.com')
    expect(formatAccount({ email: 'a@x.com' })).toBe('a@x.com')
  })
})
