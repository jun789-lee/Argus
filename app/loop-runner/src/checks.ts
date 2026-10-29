// Run one verifier command against a candidate and read its JSON verdict.

import { lastJsonLine, run } from './exec'
import type { CheckOutput, CheckResult, Verifier } from './types'

export interface CheckContext {
  /** Candidate directory (the run's worktree, or the known-bad tree during calibration). */
  worktree: string
  loopHome: string
  runDir: string
  iteration: number
}

/** Paths go in with forward slashes: wsl.exe strips backslashes from its arguments. */
export function substitute(command: string, ctx: CheckContext): string {
  const fwd = (p: string) => p.replace(/\\/g, '/')
  return command
    .replaceAll('{worktree}', fwd(ctx.worktree))
    .replaceAll('{loop_home}', fwd(ctx.loopHome))
    .replaceAll('{run_dir}', fwd(ctx.runDir))
    .replaceAll('{iteration}', String(ctx.iteration))
}

function isCheckOutput(v: unknown): v is CheckOutput {
  return !!v && typeof v === 'object' && typeof (v as CheckOutput).ok === 'boolean'
}

export async function runCheck(v: Verifier, ctx: CheckContext): Promise<CheckResult & { raw: string }> {
  const command = substitute(v.run, ctx)
  const res = await run(command, [], { shell: true, timeoutMs: v.timeoutMs, cwd: ctx.loopHome })
  const raw = `$ ${command}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`
  const base = { id: v.id, durationMs: res.durationMs, timedOut: res.timedOut, raw }
  if (res.timedOut) {
    return { ...base, ok: false, metrics: {}, message: `Check timed out after ${Math.round(v.timeoutMs / 60000)} min.` }
  }
  const parsed = lastJsonLine(res.stdout)
  if (!isCheckOutput(parsed)) {
    return {
      ...base,
      ok: false,
      metrics: {},
      infraError: `check "${v.id}" printed no verdict JSON (exit ${res.exitCode})`,
    }
  }
  return { ...base, ...parsed, metrics: parsed.metrics ?? {} }
}
