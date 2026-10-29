import { describe, test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCacheStatus, scanCacheStatus, TTL_1H_MS, TTL_5M_MS } from './cache-status'

function assistant(ts: string, created: { h1?: number; m5?: number } = {}, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: {
      usage: {
        cache_read_input_tokens: 100,
        cache_creation: {
          ephemeral_1h_input_tokens: created.h1 ?? 0,
          ephemeral_5m_input_tokens: created.m5 ?? 0,
        },
      },
    },
    ...extra,
  })
}

describe('scanCacheStatus', () => {
  test('uses the last response time and the most recent cache-write TTL', () => {
    const lines = [
      assistant('2026-01-01T00:00:00Z', { m5: 10 }),
      assistant('2026-01-01T00:01:00Z', { h1: 10 }),
      assistant('2026-01-01T00:02:00Z'), // pure cache read — no TTL info
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:03:00Z' }),
    ]
    expect(scanCacheStatus(lines)).toEqual({
      lastRequestAt: Date.parse('2026-01-01T00:02:00Z'),
      ttlMs: TTL_1H_MS,
    })
  })

  test('ignores sidechain (subagent) responses', () => {
    const lines = [
      assistant('2026-01-01T00:00:00Z', { m5: 1 }),
      assistant('2026-01-01T00:05:00Z', { h1: 1 }, { isSidechain: true }),
    ]
    expect(scanCacheStatus(lines)).toEqual({
      lastRequestAt: Date.parse('2026-01-01T00:00:00Z'),
      ttlMs: TTL_5M_MS,
    })
  })

  test('returns nulls when there are no responses', () => {
    expect(scanCacheStatus(['', 'not json', '{"type":"user"}'])).toEqual({
      lastRequestAt: null,
      ttlMs: null,
    })
  })
})

describe('readCacheStatus', () => {
  test('finds a TTL that is far from the tail by widening the read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-status-'))
    const path = join(dir, 't.jsonl')
    const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(1000) })
    const lines = [
      assistant('2026-01-01T00:00:00Z', { h1: 5 }),
      ...Array(600).fill(filler), // ~600KB, larger than the first 256KB chunk
      assistant('2026-01-01T00:10:00Z'),
    ]
    writeFileSync(path, lines.join('\n') + '\n')
    try {
      const status = await readCacheStatus(path, 10 * 1024 * 1024)
      expect(status.lastRequestAt).toBe(Date.parse('2026-01-01T00:10:00Z'))
      expect(status.ttlMs).toBe(TTL_1H_MS)
      expect(status.expiresAt).toBe(Date.parse('2026-01-01T00:10:00Z') + TTL_1H_MS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
