// Tracks which Claude account(s) a session ran under. The hook lib
// attaches `_meta.account` on SessionStart / UserPromptSubmit; a session
// resumed (or `/login`-switched) under another subscription keeps the
// same session id, so one session can accumulate several accounts.
//
// Stored in session metadata as:
//   account:  the most recent account
//   accounts: every distinct account seen, in first-seen order

import type { EventEnvelopeAccount } from '../types'

export interface SessionAccount extends EventEnvelopeAccount {
  firstSeen: number
}

/**
 * Returns the metadata patch to apply, or null when the account is
 * unchanged (so steady-state prompts don't rewrite the row).
 */
export function accountMetadataPatch(
  existingMetadata: string | null | undefined,
  account: EventEnvelopeAccount | undefined,
  timestamp: number,
): { account: EventEnvelopeAccount; accounts: SessionAccount[] } | null {
  if (!account || typeof account.email !== 'string' || !account.email) return null

  let meta: Record<string, unknown> = {}
  try {
    meta = existingMetadata ? JSON.parse(existingMetadata) : {}
  } catch {
    meta = {}
  }
  const current = meta.account as EventEnvelopeAccount | undefined
  const accounts = Array.isArray(meta.accounts) ? (meta.accounts as SessionAccount[]) : []

  const clean: EventEnvelopeAccount = { email: account.email }
  if (account.name) clean.name = account.name
  if (account.org) clean.org = account.org
  if (account.orgType) clean.orgType = account.orgType

  const known = accounts.some((a) => a.email === clean.email)
  const sameAsCurrent =
    current?.email === clean.email &&
    current?.name === clean.name &&
    current?.org === clean.org &&
    current?.orgType === clean.orgType
  if (sameAsCurrent && known) return null

  return {
    account: clean,
    accounts: known
      ? accounts.map((a) => (a.email === clean.email ? { ...a, ...clean } : a))
      : [...accounts, { ...clean, firstSeen: timestamp }],
  }
}
