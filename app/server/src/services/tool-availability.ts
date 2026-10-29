// Detects whether Claude had its to-do list tools in a session, so the
// dashboard can warn when plans can't be recorded. Since Claude Code
// 2.1.233 newer models don't get TaskCreate / TodoWrite unless
// CLAUDE_CODE_ENABLE_TODO_TOOLS=1 is set, and the failure is silent.
//
// Two transcript entries reveal the tool set:
//   - `api-request-shape`: the tools sent with a request (loaded tools)
//   - a "deferred tools are now available" reminder: tools loadable via
//     ToolSearch, listed one name per line
// The newest of each wins; a tool counts as available if either lists it.

import { promises as fs } from 'node:fs'

export const TODO_TOOLS = ['TaskCreate', 'TodoWrite'] as const

export interface ToolAvailability {
  /** null when the transcript has no tool information yet. */
  todoTools: boolean | null
  /** Which of TODO_TOOLS were seen. */
  found: string[]
}

const DEFERRED_MARKER = 'deferred tools are now available'

function namesFromShape(entry: any): string[] {
  const tools = Array.isArray(entry?.shape?.tools) ? entry.shape.tools : []
  return tools.map((t: any) => t?.name).filter((n: unknown) => typeof n === 'string')
}

function namesFromDeferred(text: string): string[] {
  const start = text.indexOf(DEFERRED_MARKER)
  if (start === -1) return []
  // The list runs one name per line until the reminder closes.
  return text
    .slice(start)
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z0-9_]+$/.test(l))
}

/** Scan transcript lines newest-first for the latest tool set. */
export function detectToolAvailability(lines: string[]): ToolAvailability {
  let shapeNames: string[] | null = null
  let deferredNames: string[] | null = null
  for (let i = lines.length - 1; i >= 0 && (shapeNames === null || deferredNames === null); i--) {
    const line = lines[i]
    const isShape = shapeNames === null && line.includes('"api-request-shape"')
    const isDeferred = deferredNames === null && line.includes(DEFERRED_MARKER)
    if (!isShape && !isDeferred) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (isShape && entry?.type === 'api-request-shape') shapeNames = namesFromShape(entry)
    if (isDeferred) {
      // The reminder text sits somewhere inside the entry; search its strings.
      const texts: string[] = []
      const walk = (v: unknown) => {
        if (typeof v === 'string') texts.push(v)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
      }
      walk(entry)
      const text = texts.find((t) => t.includes(DEFERRED_MARKER))
      if (text) deferredNames = namesFromDeferred(text)
    }
  }
  if (shapeNames === null && deferredNames === null) return { todoTools: null, found: [] }
  const all = new Set([...(shapeNames ?? []), ...(deferredNames ?? [])])
  const found = TODO_TOOLS.filter((t) => all.has(t))
  return { todoTools: found.length > 0, found }
}

export async function readToolAvailability(
  path: string,
  maxBytes: number,
): Promise<ToolAvailability> {
  const handle = await fs.open(path, 'r')
  try {
    const { size } = await handle.stat()
    const limit = Math.min(size, maxBytes)
    // The tool set is re-sent with every request, so the tail usually has
    // it — but a few huge entries (images, big tool output) can push it out,
    // so widen the window until something is found.
    let chunk = 4 * 1024 * 1024
    while (true) {
      const length = Math.min(chunk, limit)
      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, size - length)
      const lines = buf.toString('utf8').split('\n')
      if (length < size) lines.shift()
      const result = detectToolAvailability(lines)
      if (result.todoTools !== null || length >= limit) return result
      chunk *= 4
    }
  } finally {
    await handle.close()
  }
}
