// Claude account(s) a session ran under, as recorded by the server in
// session metadata (`account` = current, `accounts` = history).

export interface SessionAccount {
  email: string
  name?: string
  org?: string
  orgType?: string
  firstSeen?: number
}

function isAccount(v: unknown): v is SessionAccount {
  return !!v && typeof v === 'object' && typeof (v as SessionAccount).email === 'string'
}

export function getSessionAccounts(metadata: Record<string, unknown> | null | undefined): {
  current: SessionAccount | null
  all: SessionAccount[]
} {
  const current = isAccount(metadata?.account) ? metadata.account : null
  const all = Array.isArray(metadata?.accounts) ? metadata.accounts.filter(isAccount) : []
  if (current && !all.some((a) => a.email === current.email)) all.push(current)
  return { current, all }
}

/** "me@example.com · My Org" — org omitted when it just repeats the email. */
export function formatAccount(a: SessionAccount): string {
  return a.org && !a.org.includes(a.email) ? `${a.email} · ${a.org}` : a.email
}
