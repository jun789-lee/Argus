// The orchestrator (design §6): it owns scoring, budgets and stop decisions; the worker only
// edits files. One fresh worker session per iteration, every iteration a commit, the journal
// the source of truth.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { runCheck, type CheckContext } from './checks'
import { applyIteration, judge, nextOperator, scoredFrom, stopReason, type LoopState } from './decide'
import { changedFiles, commitAll, createWorktree, head, resetTo } from './git'
import { hashTree, reviewChanges } from './integrity'
import * as journal from './journal'
import { loadSpec } from './spec'
import type { CheckResult, Scored, Spec, TerminalReason, Verdict } from './types'
import { buildPrompt, labelSession, runWorker } from './worker'

export interface RunOptions {
  loopHome: string
  /** Approve the start gate without asking; alerts then stop the run instead of pausing. */
  yes?: boolean
  /** A human approving the start gate from the command line (recorded as such). */
  approve?: boolean
  /** Test mode: a command that stands in for Claude Code. */
  fakeWorker?: string
  /** Resume this run instead of starting a new one. */
  resumeRunId?: string
  log?: (line: string) => void
}

export interface RunSummary {
  runId: string
  runDir: string
  reason: TerminalReason | 'awaiting_start'
  baseline: Scored
  best: Scored
  branch: string
  worktree: string
  iterations: number
  costUsd: number
}

const SEALED_FEEDBACK = 'Not accepted: the candidate failed an additional check.'

/** Journal copy of a check: no raw output (that lives in logs/), and nothing but pass/fail
 *  for sealed checks, whose details must never reach a worker. */
function forJournal(c: CheckResult & { raw?: string }, sealed: boolean): CheckResult {
  const { raw: _raw, ...rest } = c
  return sealed ? { ...rest, message: rest.ok ? 'PASS' : 'FAIL', metrics: {}, se: undefined, cases: undefined } : rest
}

function newRunId() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function trim(text: string, max = 3000) {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max / 2)}\n...\n${t.slice(-max / 2)}`
}

function pct(delta: number, base: number) {
  return base === 0 ? '' : ` (${((delta / Math.abs(base)) * 100).toFixed(2)}%)`
}

/** Grader files the worker must never change: the loop's verifiers folder and the spec. */
function graderHashes(loopHome: string): Record<string, string> {
  const out: Record<string, string> = { 'spec.yaml': hashTree(join(loopHome, 'spec.yaml')) }
  const verifiers = join(loopHome, 'verifiers')
  if (existsSync(verifiers)) out['verifiers/'] = hashTree(verifiers)
  return out
}

function acquireLock(loopHome: string): () => void {
  const lock = join(loopHome, 'runs', '.lock')
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'))
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      /* stale lock */
    }
    if (alive) throw new Error(`Another run of this loop is active (pid ${pid}).`)
  }
  writeFileSync(lock, String(process.pid))
  return () => rmSync(lock, { force: true })
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

export async function runLoop(opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const loopHome = opts.loopHome
  const { spec, errors, warnings, text } = loadSpec(join(loopHome, 'spec.yaml'))
  if (!spec) throw new Error(`Spec is invalid:\n- ${errors.join('\n- ')}`)
  for (const w of warnings) log(`warning: ${w}`)

  mkdirSync(join(loopHome, 'runs'), { recursive: true })
  const release = acquireLock(loopHome)
  try {
    return await runWithLock(spec, text, opts, log)
  } finally {
    release()
  }
}

async function runWithLock(
  spec: Spec,
  specText: string,
  opts: RunOptions,
  log: (l: string) => void,
): Promise<RunSummary> {
  const loopHome = opts.loopHome
  const runId = opts.resumeRunId ?? newRunId()
  const runDir = join(loopHome, 'runs', runId)
  const logs = join(runDir, 'logs')
  const journalPath = join(runDir, 'journal.jsonl')
  mkdirSync(logs, { recursive: true })
  const saveLog = (name: string, content: string) => writeFileSync(join(logs, name), content)

  let events = journal.read(journalPath)
  let started: (journal.RunStartedEvent & { t?: string }) | undefined = events.find(
    (e): e is journal.RunStartedEvent & { t?: string } => e.type === 'run_started',
  )
  if (opts.resumeRunId && !started) throw new Error(`No run ${runId} to resume.`)
  if (events.some((e) => e.type === 'run_finished')) throw new Error(`Run ${runId} already finished.`)

  // ── Start: worktree, grader fingerprints ──────────────────────────────
  if (!started) {
    const branch = `loop/${spec.name}/${runId}`
    const worktree = join(spec.workspace.repo, '.worktrees', `loop-${spec.name}-${runId}`).replace(/\\/g, '/')
    const baseCommit = await createWorktree(spec.workspace.repo, spec.workspace.baseRef, worktree, branch)
    started = {
      type: 'run_started',
      runId,
      loop: spec.name,
      specText,
      spec,
      worktree,
      branch,
      baseCommit,
      graderHashes: graderHashes(loopHome),
    }
    journal.append(journalPath, started)
    log(`run ${runId}: worktree ${worktree} (branch ${branch})`)
  } else {
    log(`resuming run ${runId}`)
  }
  const { worktree, branch } = started
  const runSpec = started.spec // a resumed run keeps the spec it started with
  const ctx = (iteration: number, dir = worktree): CheckContext => ({ worktree: dir, loopHome, runDir, iteration })
  const gates = runSpec.verifiers.filter((v) => v.role === 'gate' && v.when === 'every')
  const scoreCheck = runSpec.verifiers.find((v) => v.role === 'score')!
  const onAccept = runSpec.verifiers.filter((v) => v.when === 'on_accept')

  // ── Calibration (once per run): baseline, repeat scoring, known-bad ──
  let calibration = events.find((e): e is journal.CalibrationEvent => e.type === 'calibration')
  if (!calibration) {
    log('calibrating the graders on the baseline...')
    const calWarnings: string[] = []
    const results: CheckResult[] = []
    for (const g of gates) {
      const r = await runCheck(g, ctx(0))
      saveLog(`calibration-${g.id}.txt`, r.raw)
      results.push(forJournal(r, false))
      if (!r.ok) throw new Error(`The baseline fails check "${g.id}": ${r.infraError ?? r.message}`)
    }
    const scores: Scored[] = []
    for (let i = 0; i < Math.max(1, runSpec.calibration.repeats); i++) {
      const r = await runCheck(scoreCheck, ctx(0))
      saveLog(`calibration-score-${i + 1}.txt`, r.raw)
      results.push(forJournal(r, false))
      const s = r.ok ? scoredFrom(r, runSpec.acceptance.metric, 0, started.baseCommit) : null
      if (!s) throw new Error(`The baseline score check failed: ${r.infraError ?? r.message ?? 'no metric'}`)
      scores.push(s)
    }
    const values = scores.map((s) => s.value)
    if (runSpec.preset === 'optimization' && new Set(values).size > 1) {
      calWarnings.push(`The same baseline scored differently across repeats (${values.join(', ')}) though this preset expects a deterministic score.`)
    }
    for (const v of onAccept) {
      const r = await runCheck(v, ctx(0))
      saveLog(`calibration-${v.id}.txt`, r.raw)
      results.push(forJournal(r, v.access === 'sealed'))
      if (v.role === 'gate' && !r.ok) {
        throw new Error(`The baseline fails the sealed check "${v.id}": ${r.infraError ?? 'see logs'}`)
      }
    }
    let knownBad: CheckResult | null = null
    if (runSpec.calibration.knownBad) {
      const probe = gates[0] ?? scoreCheck
      const r = await runCheck(probe, ctx(0, runSpec.calibration.knownBad))
      saveLog('calibration-known-bad.txt', r.raw)
      knownBad = forJournal(r, false)
      const badScore = r.ok ? scoredFrom(r, runSpec.acceptance.metric, 0, '') : null
      const caught =
        !r.ok || (badScore !== null && !judge(badScore, scores[0], runSpec.acceptance).accept && badScore.value !== scores[0].value)
      if (r.infraError || !caught) {
        throw new Error(
          `The graders did not reject the known-bad candidate (${r.infraError ?? r.message ?? 'passed'}). ` +
            'Fix the graders before running a loop on them.',
        )
      }
    }
    calibration = { type: 'calibration', baseline: scores[0], checks: results, knownBad, warnings: calWarnings }
    journal.append(journalPath, calibration)
    for (const w of calWarnings) log(`warning: ${w}`)
    log(`baseline ${runSpec.acceptance.metric} = ${scores[0].value}`)

    events = journal.read(journalPath)
  }

  // Start gate: a human approves the graders before any optimization. Without a terminal
  // (and without --yes) the run waits here: calibration is kept, and `resume --yes` starts it.
  const startGate = events.find((e): e is journal.GateEvent => e.type === 'gate' && e.kind === 'start')
  if (runSpec.humanGates.start === 'required' && !startGate) {
    const values = calibration.checks.filter((c) => c.id === scoreCheck.id).map((c) => c.metrics[runSpec.acceptance.metric])
    const kb = calibration.knownBad
    const summary =
      `Baseline ${runSpec.acceptance.metric}: ${values.join(' / ')} over ${values.length} runs; ` +
      `known-bad: ${kb ? (kb.ok ? 'scored worse' : `rejected (${kb.message ?? ''})`) : 'not configured'}` +
      (calibration.warnings.length ? `; warnings: ${calibration.warnings.join(' ')}` : '') + '.'
    log(summary)
    const preApproved = opts.yes || opts.approve
    if (!preApproved && !process.stdin.isTTY) {
      log(`waiting for start approval: argus-loop resume ${runSpec.name} ${runId} --approve`)
      return { runId, runDir, reason: 'awaiting_start', baseline: calibration.baseline, best: calibration.baseline, branch, worktree, iterations: 0, costUsd: 0 }
    }
    const go = preApproved || (await ask('Start the loop with these graders?'))
    journal.append(journalPath, {
      type: 'gate',
      kind: 'start',
      reason: summary,
      decision: go ? 'continue' : 'stop',
      by: opts.yes && !opts.approve ? 'auto' : 'terminal',
    })
    if (!go) return finish('user_stopped')
    events = journal.read(journalPath)
  } else if (startGate?.decision === 'stop') {
    throw new Error(`Run ${runId} was not approved to start.`)
  }

  // ── Rebuild state from the journal ────────────────────────────────────
  const baseline = calibration.baseline
  // The time budget runs from the start approval, not from calibration.
  const approvedAt = events.find((e) => e.type === 'gate' && e.kind === 'start')?.t ?? started.t
  let state: LoopState = {
    startedAt: approvedAt ? Date.parse(approvedAt) : Date.now(),
    iterationsDone: 0,
    best: baseline,
    head: baseline.commit,
    improveMisses: 0,
    debug: null,
    integrityViolations: 0,
    costUsd: 0,
  }
  for (const it of journal.iterations(events)) {
    state = applyIteration(state, runSpec, {
      operator: it.operator,
      verdict: it.verdict,
      commit: it.commit,
      candidate: it.scored,
      costUsd: it.costUsd,
      error: it.error ?? undefined,
    })
  }
  await resetTo(worktree, state.head)

  // ── The loop ───────────────────────────────────────────────────────────
  for (;;) {
    const reason = stopReason(state, runSpec, Date.now())
    if (reason) return finish(reason)

    const n = state.iterationsDone + 1
    const operator = nextOperator(state)
    const startCommit = await head(worktree)
    const sessionId = opts.fakeWorker ? null : randomUUID()
    const history = journal.iterations(journal.read(journalPath))
    const prompt = buildPrompt(runSpec, state, baseline.value, history, operator)
    saveLog(`iter-${n}-prompt.md`, prompt)
    log(`#${n} ${operator}: worker started${sessionId ? ` (session ${sessionId})` : ''}`)

    const t0 = Date.now()
    const w = await runWorker(runSpec, prompt, {
      cwd: worktree,
      sessionId: sessionId ?? 'fake',
      operator,
      iteration: n,
      fakeWorker: opts.fakeWorker,
    })
    saveLog(`iter-${n}-worker.txt`, w.raw)
    if (sessionId) void labelSession(sessionId, `loop:${runSpec.name} #${runId}-${n}`)

    let verdict: Verdict
    let feedback: string
    let error: string | null = null
    let commit: string | null = null
    let judgement: journal.IterationEvent['judgement'] = null
    let scored: Scored | null = null
    const checks: CheckResult[] = []
    let files: string[] = []
    let alert: string | null = null

    // Graders must be byte-for-byte what the run started with (G3).
    const hashes = graderHashes(loopHome)
    const tampered = Object.keys(started.graderHashes).filter((k) => hashes[k] !== started.graderHashes[k])

    if (tampered.length) {
      verdict = 'integrity_violation'
      feedback = 'Rejected: integrity check failed.'
      alert = `Grader files changed during the iteration: ${tampered.join(', ')}. Stopping.`
    } else if (w.timedOut) {
      verdict = 'timeout'
      feedback = `Rejected: the attempt ran out of time (limit ${Math.round(runSpec.worker.timeoutMs / 60000)} min).`
    } else if (w.report?.needs_human) {
      verdict = 'rejected'
      feedback = 'Paused for a human: ' + (w.report.needs_human_reason ?? '')
      alert = `The worker asked for a human: ${w.report.needs_human_reason ?? '(no reason given)'}`
    } else {
      files = await changedFiles(worktree, startCommit)
      const review = reviewChanges(files, runSpec.workspace.editable, runSpec.workspace.protected)
      if (files.length === 0) {
        verdict = 'no_change'
        feedback = 'No change was made.'
      } else if (review.protectedHits.length) {
        verdict = 'integrity_violation'
        feedback = 'Rejected: integrity check failed.'
        alert = `Protected files changed: ${review.protectedHits.join(', ')}.`
      } else if (review.outOfScope.length) {
        verdict = 'out_of_scope'
        feedback = `Rejected: only files matching ${runSpec.workspace.editable.join(', ')} may be changed.`
      } else {
        commit = await commitAll(worktree, `loop ${runSpec.name} #${n} (${operator}): ${w.report?.hypothesis ?? ''}`.slice(0, 200))
        ;({ verdict, feedback, error, judgement, scored } = await evaluate(n, commit, checks))
      }
    }

    const it: journal.IterationEvent = {
      type: 'iteration',
      n,
      operator,
      sessionId,
      startCommit,
      commit,
      report: w.report,
      workerExit: w.exit,
      changedFiles: files,
      checks,
      verdict,
      judgement,
      scored,
      feedback,
      error,
      costUsd: w.costUsd,
      durationMs: Date.now() - t0,
    }
    journal.append(journalPath, it)
    state = applyIteration(state, runSpec, { operator, verdict, commit, candidate: scored, costUsd: w.costUsd, error: error ?? undefined })
    await resetTo(worktree, state.head)
    log(`#${n} ${verdict}: ${feedback}`)

    if (alert) {
      const fatal = tampered.length > 0 || state.integrityViolations >= 2
      log(`ALERT: ${alert}`)
      const go = !fatal && !opts.yes && runSpec.humanGates.onAlert === 'pause' && (await ask('Continue the loop?'))
      journal.append(journalPath, { type: 'gate', kind: 'alert', reason: alert, decision: go ? 'continue' : 'stop', by: opts.yes ? 'auto' : 'terminal' })
      if (!go) return finish(verdict === 'integrity_violation' ? 'integrity_violation' : 'escalated')
    }
  }

  // Score a committed candidate: gates, then the score, then the sealed check if it would win.
  async function evaluate(n: number, commit: string, checks: CheckResult[]) {
    for (const g of gates) {
      const r = await runCheck(g, ctx(n))
      saveLog(`iter-${n}-${g.id}.txt`, r.raw)
      checks.push(forJournal(r, false))
      if (r.infraError) throw new Error(r.infraError)
      if (!r.ok) {
        return { verdict: 'bug' as Verdict, feedback: `Failed check "${g.id}": ${trim(r.message ?? '', 600)}`, error: trim(r.message ?? ''), judgement: null, scored: null }
      }
    }
    const r = await runCheck(scoreCheck, ctx(n))
    saveLog(`iter-${n}-${scoreCheck.id}.txt`, r.raw)
    checks.push(forJournal(r, false))
    if (r.infraError) throw new Error(r.infraError)
    const s = r.ok ? scoredFrom(r, runSpec.acceptance.metric, n, commit) : null
    if (!s) {
      return { verdict: 'bug' as Verdict, feedback: `Failed the score check: ${trim(r.message ?? 'no metric', 600)}`, error: trim(r.message ?? ''), judgement: null, scored: null }
    }
    const j = judge(s, state.best, runSpec.acceptance)
    const metric = runSpec.acceptance.metric
    if (!j.accept) {
      return {
        verdict: 'rejected' as Verdict,
        feedback: `Not accepted: ${metric} ${s.value} vs best ${state.best.value}${pct(j.delta, state.best.value)}; needed an improvement above ${j.threshold.toPrecision(4)}.`,
        error: null,
        judgement: j,
        scored: null,
      }
    }
    for (const v of onAccept) {
      const sr = await runCheck(v, ctx(n))
      saveLog(`iter-${n}-${v.id}.txt`, sr.raw)
      checks.push(forJournal(sr, v.access === 'sealed'))
      if (sr.infraError) throw new Error(sr.infraError)
      if (v.role === 'gate' && !sr.ok) {
        return { verdict: 'rejected' as Verdict, feedback: SEALED_FEEDBACK, error: null, judgement: j, scored: null }
      }
    }
    return {
      verdict: 'accepted' as Verdict,
      feedback: `Accepted: ${metric} ${state.best.value} -> ${s.value}${pct(j.delta, state.best.value)}.`,
      error: null,
      judgement: j,
      scored: s,
    }
  }

  async function finish(reason: TerminalReason): Promise<RunSummary> {
    const evs = journal.read(journalPath)
    const its = journal.iterations(evs)
    const cal = evs.find((e): e is journal.CalibrationEvent => e.type === 'calibration')
    const base = cal?.baseline ?? { iteration: 0, commit: started!.baseCommit, value: NaN, se: null, cases: null }
    const best = its.filter((i) => i.verdict === 'accepted' && i.scored).map((i) => i.scored!).at(-1) ?? base
    const costUsd = its.reduce((a, i) => a + i.costUsd, 0)
    journal.append(journalPath, { type: 'run_finished', reason, best, baseline: base, iterations: its.length, costUsd })
    if (best.commit) await resetTo(worktree, best.commit)
    const summary: RunSummary = { runId, runDir, reason, baseline: base, best, branch, worktree, iterations: its.length, costUsd }
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2))
    log(
      `finished (${reason}): ${runSpec.acceptance.metric} ${base.value} -> ${best.value}` +
        `${pct((runSpec.acceptance.direction === 'minimize' ? -1 : 1) * (best.value - base.value), base.value)} ` +
        `after ${its.length} iterations, $${costUsd.toFixed(2)}. Best is on branch ${branch} (${best.commit.slice(0, 8)}).`,
    )
    return summary
  }
}
