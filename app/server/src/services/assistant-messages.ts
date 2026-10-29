// Extracts Claude's visible text replies from a Claude Code transcript so
// the prompt view can interleave them with the hook-event log.
//
// Transcript entries are written in order. Every `user` entry carries the
// `promptId` it belongs to (the same id hooks put in `prompt_id`), and the
// assistant entries that answer it follow, so tracking the most recent
// promptId attributes each reply exactly. One API response is logged as
// several entries (one per content block) sharing a `requestId`; their
// text blocks are merged. Thinking and tool_use blocks are skipped —
// tool calls already appear as hook events.

import { promises as fs } from 'node:fs'

export interface AssistantMessage {
  timestamp: number
  text: string
}

export function extractAssistantMessages(
  lines: string[],
  opts: { promptId?: string | null; includeSidechain?: boolean } = {},
): AssistantMessage[] {
  const out: AssistantMessage[] = []
  let currentPrompt: string | null = null
  let lastRequestId: string | null = null
  for (const line of lines) {
    // Pre-filter: only user (promptId tracking) and assistant entries matter.
    if (!line.includes('"type":"assistant"') && !line.includes('"promptId"')) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type === 'user') {
      if (typeof entry.promptId === 'string') currentPrompt = entry.promptId
      continue
    }
    if (entry?.type !== 'assistant') continue
    if (entry.isSidechain && !opts.includeSidechain) continue
    if (opts.promptId && currentPrompt !== opts.promptId) continue
    const blocks = Array.isArray(entry.message?.content) ? entry.message.content : []
    const text = blocks
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
      .map((b: any) => b.text.trim())
      .join('\n\n')
    if (!text) continue
    const ts = Date.parse(entry.timestamp)
    const requestId = typeof entry.requestId === 'string' ? entry.requestId : null
    const prev = out[out.length - 1]
    if (prev && requestId && requestId === lastRequestId) {
      prev.text = `${prev.text}\n\n${text}`
    } else {
      out.push({ timestamp: Number.isFinite(ts) ? ts : (prev?.timestamp ?? 0), text })
    }
    lastRequestId = requestId
  }
  return out
}

export async function readAssistantMessages(
  path: string,
  maxBytes: number,
  opts: { promptId?: string | null; includeSidechain?: boolean } = {},
): Promise<AssistantMessage[]> {
  const stat = await fs.stat(path)
  if (stat.size > maxBytes) {
    const err: any = new Error('Transcript file exceeds the size cap.')
    err.code = 'E2BIG'
    throw err
  }
  const content = await fs.readFile(path, 'utf8')
  return extractAssistantMessages(content.split('\n'), opts)
}
