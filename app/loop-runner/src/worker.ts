// The worker: one fresh headless Claude Code session per iteration, given a prompt the runner
// builds from the spec and the journal. The session reports back through a JSON schema.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { lastJsonLine, run } from './exec'
import type { LoopState } from './decide'
import type { IterationEvent } from './journal'
import type { Spec, WorkerReport } from './types'

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    hypothesis: { type: 'string', description: 'What you tried and why you expected it to help.' },
    change_summary: { type: 'string', description: 'What you changed.' },
    lesson: { type: 'string', description: 'One lesson for later attempts (optional).' },
    needs_human: {
      type: 'boolean',
      description: 'True only if the goal looks impossible or the rules conflict.',
    },
    needs_human_reason: { type: 'string' },
  },
  required: ['hypothesis', 'change_summary', 'needs_human'],
}

function fmt(v: number) {
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toPrecision(6)
}

export function buildPrompt(
  spec: Spec,
  state: LoopState,
  baseline: number,
  history: IterationEvent[],
  operator: 'improve' | 'debug',
): string {
  const acc = spec.acceptance
  const better = acc.direction === 'minimize' ? 'lower' : 'higher'
  const lines: string[] = []
  lines.push(`# Goal\n${spec.goal.objective}`)
  if (spec.goal.constraints.length) {
    lines.push(`# Rules\n${spec.goal.constraints.map((c) => `- ${c}`).join('\n')}`)
  }
  lines.push(
    `# What you may change\nOnly files matching: ${spec.workspace.editable.join(', ')}.` +
      (spec.workspace.protected.length ? `\nNever change: ${spec.workspace.protected.join(', ')}.` : '') +
      `\nWork in the current directory. Do not commit or push; the loop commits for you.`,
  )
  lines.push(`# Background\n${spec.worker.instructions.trim()}`)

  const accepted = history.filter((h) => h.verdict === 'accepted')
  lines.push(
    `# Current best\n${acc.metric} = ${fmt(state.best.value)} (${better} is better; baseline ${fmt(baseline)}).` +
      (accepted.length
        ? `\nReached by:\n${accepted.map((h) => `- #${h.n}: ${h.report?.hypothesis ?? '(no report)'}`).join('\n')}`
        : '\nNo accepted change yet: you start from the baseline.'),
  )

  const recent = history.slice(-spec.memory.showLast)
  if (recent.length) {
    lines.push(
      `# Recent attempts\n${recent
        .map((h) => `- #${h.n} (${h.operator}) ${h.report?.hypothesis ?? '(no report)'}\n  -> ${h.feedback}`)
        .join('\n')}`,
    )
  }
  const lessons = history
    .map((h) => h.report?.lesson?.trim())
    .filter((l): l is string => !!l)
    .slice(-spec.memory.reflections)
  if (lessons.length) lines.push(`# Lessons so far\n${lessons.map((l) => `- ${l}`).join('\n')}`)

  if (operator === 'debug' && state.debug) {
    lines.push(
      `# Your task: debug\nThe last candidate (still in this directory) failed:\n\n${state.debug.error.slice(0, 4000)}\n\n` +
        'Find the cause and fix it, keeping the idea of that attempt.',
    )
  } else {
    lines.push(
      `# Your task: improve\nPick ONE hypothesis for making ${acc.metric} ${better}, and make the single change that tests it. ` +
        `A change is accepted only if it beats the best by at least ${(acc.relative * 100).toFixed(2)}%. ` +
        'Check your work before finishing. If the goal looks impossible or the rules conflict, set needs_human instead of working around a check.',
    )
  }
  lines.push('# Report\nFinish with the structured report: hypothesis, change_summary, an optional lesson, needs_human.')
  return lines.join('\n\n')
}

/** Claude Code's real executable: on Windows the npm `claude.cmd` shim can't be spawned without a shell. */
export function claudeBinary(): string {
  if (process.env.ARGUS_CLAUDE_BIN) return process.env.ARGUS_CLAUDE_BIN
  if (process.platform === 'win32' && process.env.APPDATA) {
    const exe = join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(exe)) return exe
  }
  return 'claude'
}

export interface WorkerResult {
  report: WorkerReport | null
  costUsd: number
  /** `success`, `timeout`, or what went wrong. */
  exit: string
  timedOut: boolean
  raw: string
}

function parseWorkerOutput(stdout: string): { report: WorkerReport | null; costUsd: number; exit: string } {
  let out: Record<string, unknown> | null = null
  try {
    out = JSON.parse(stdout)
  } catch {
    out = lastJsonLine(stdout) as Record<string, unknown> | null
  }
  if (!out) return { report: null, costUsd: 0, exit: 'no JSON output' }
  const report = (out.structured_output ?? null) as WorkerReport | null
  const costUsd = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : 0
  const exit = out.is_error ? `error: ${String(out.subtype ?? out.result ?? 'unknown')}` : String(out.subtype ?? 'success')
  return { report, costUsd, exit }
}

export async function runWorker(
  spec: Spec,
  prompt: string,
  opts: {
    cwd: string
    sessionId: string
    operator: string
    iteration: number
    fakeWorker?: string
    signal?: AbortSignal
  },
): Promise<WorkerResult> {
  let res
  if (opts.fakeWorker) {
    // Test mode: a script stands in for Claude and prints the same result JSON.
    res = await run(opts.fakeWorker, [], {
      cwd: opts.cwd,
      shell: true,
      timeoutMs: spec.worker.timeoutMs,
      signal: opts.signal,
      input: prompt,
      env: {
        ...process.env,
        ARGUS_LOOP_OPERATOR: opts.operator,
        ARGUS_LOOP_ITERATION: String(opts.iteration),
      },
    })
  } else {
    const args = [
      '-p',
      '--model', spec.worker.model,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(REPORT_SCHEMA),
      '--session-id', opts.sessionId,
      '--permission-mode', spec.worker.permissionMode,
    ]
    if (Object.keys(spec.worker.settingsEnv).length) {
      args.push('--settings', JSON.stringify({ env: spec.worker.settingsEnv }))
    }
    if (spec.worker.allowedTools.length) args.push('--allowedTools', ...spec.worker.allowedTools)
    if (spec.worker.disallowedTools.length) args.push('--disallowedTools', ...spec.worker.disallowedTools)
    res = await run(claudeBinary(), args, {
      cwd: opts.cwd,
      timeoutMs: spec.worker.timeoutMs,
      input: prompt,
      signal: opts.signal,
    })
  }
  const raw = `--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`
  if (res.timedOut) return { report: null, costUsd: 0, exit: 'timeout', timedOut: true, raw }
  return { ...parseWorkerOutput(res.stdout), timedOut: false, raw }
}

/** Best effort: name the iteration's session in Argus and tag its metadata with the loop it
 *  belongs to, so the dashboard can classify it as a loop session and link it to the run. */
export async function labelSession(
  sessionId: string,
  slug: string,
  loop: { name: string; runId: string; n: number; operator: string },
) {
  const base = process.env.AGENTS_OBSERVE_API_BASE_URL ?? 'http://127.0.0.1:4981/api'
  const send = (path: string, body: object) =>
    fetch(`${base}/sessions/${encodeURIComponent(sessionId)}${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    })
  try {
    await send('', { slug })
    await send('/metadata', { loop })
  } catch {
    /* Argus not running: the journal still has everything. */
  }
}
