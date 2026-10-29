// Estimates when a session's prompt cache expires, from its transcript.
//
// Every main-chain API response is logged as an `assistant` entry whose
// `message.usage.cache_creation` splits written tokens into
// `ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`, which tells
// us the TTL actually in use. Each request (cache read or write) resets
// the TTL, so expiry ≈ timestamp of the last response + TTL. The entry is
// stamped when the response is logged, so this runs a few seconds late
// at most.

import { promises as fs } from 'node:fs'

export const TTL_1H_MS = 60 * 60 * 1000
export const TTL_5M_MS = 5 * 60 * 1000

export interface CacheStatus {
  /** Timestamp (ms) of the last main-chain API response. */
  lastRequestAt: number | null
  /** TTL of the most recent cache write, or null when none was seen. */
  ttlMs: number | null
  /** lastRequestAt + ttlMs, or null when either is unknown. */
  expiresAt: number | null
}

interface Scan {
  lastRequestAt: number | null
  ttlMs: number | null
}

/** Scan transcript lines newest-first; stops once both values are found. */
export function scanCacheStatus(lines: string[]): Scan {
  let lastRequestAt: number | null = null
  let ttlMs: number | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    // Cheap pre-filter before JSON.parse on potentially huge lines.
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type !== 'assistant' || entry.isSidechain) continue
    const usage = entry.message?.usage
    if (!usage) continue
    if (lastRequestAt === null) {
      const ts = Date.parse(entry.timestamp)
      if (Number.isFinite(ts)) lastRequestAt = ts
    }
    if (ttlMs === null) {
      const created = usage.cache_creation
      if (created?.ephemeral_1h_input_tokens > 0) ttlMs = TTL_1H_MS
      else if (created?.ephemeral_5m_input_tokens > 0) ttlMs = TTL_5M_MS
    }
    if (lastRequestAt !== null && ttlMs !== null) break
  }
  return { lastRequestAt, ttlMs }
}

export function toCacheStatus(scan: Scan): CacheStatus {
  return {
    ...scan,
    expiresAt:
      scan.lastRequestAt !== null && scan.ttlMs !== null ? scan.lastRequestAt + scan.ttlMs : null,
  }
}

/**
 * Read the transcript from the end in growing chunks so the common case
 * (recent response, recent cache write) touches only the tail of the file.
 */
export async function readCacheStatus(path: string, maxBytes: number): Promise<CacheStatus> {
  const handle = await fs.open(path, 'r')
  try {
    const { size } = await handle.stat()
    const limit = Math.min(size, maxBytes)
    let chunk = 256 * 1024
    let scan: Scan = { lastRequestAt: null, ttlMs: null }
    while (true) {
      const length = Math.min(chunk, limit)
      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, size - length)
      const lines = buf.toString('utf8').split('\n')
      // The first line is probably cut mid-way unless we read from the start.
      if (length < size) lines.shift()
      scan = scanCacheStatus(lines)
      if ((scan.lastRequestAt !== null && scan.ttlMs !== null) || length >= limit) break
      chunk *= 4
    }
    return toCacheStatus(scan)
  } finally {
    await handle.close()
  }
}
