import { describe, test, expect } from 'vitest'
import { accountMetadataPatch } from './session-account'

const a = { email: 'a@example.com', name: 'A', org: 'Org A', orgType: 'claude_max' }
const b = { email: 'b@example.com', org: 'Org B' }

describe('accountMetadataPatch', () => {
  test('ignores missing or invalid accounts', () => {
    expect(accountMetadataPatch(null, undefined, 1)).toBeNull()
    expect(accountMetadataPatch(null, { email: '' }, 1)).toBeNull()
  })

  test('records the first account', () => {
    expect(accountMetadataPatch(null, a, 100)).toEqual({
      account: a,
      accounts: [{ ...a, firstSeen: 100 }],
    })
  })

  test('returns null when the account is unchanged', () => {
    const meta = JSON.stringify({ account: a, accounts: [{ ...a, firstSeen: 100 }] })
    expect(accountMetadataPatch(meta, a, 200)).toBeNull()
  })

  test('appends a new account and makes it current', () => {
    const meta = JSON.stringify({ cwd: '/x', account: a, accounts: [{ ...a, firstSeen: 100 }] })
    expect(accountMetadataPatch(meta, b, 200)).toEqual({
      account: b,
      accounts: [
        { ...a, firstSeen: 100 },
        { ...b, firstSeen: 200 },
      ],
    })
  })

  test('switching back keeps firstSeen and order', () => {
    const meta = JSON.stringify({
      account: b,
      accounts: [
        { ...a, firstSeen: 100 },
        { ...b, firstSeen: 200 },
      ],
    })
    const patch = accountMetadataPatch(meta, a, 300)
    expect(patch?.account).toEqual(a)
    expect(patch?.accounts.map((x) => [x.email, x.firstSeen])).toEqual([
      ['a@example.com', 100],
      ['b@example.com', 200],
    ])
  })

  test('tolerates malformed metadata', () => {
    expect(accountMetadataPatch('{not json', a, 1)?.accounts).toHaveLength(1)
  })
})
