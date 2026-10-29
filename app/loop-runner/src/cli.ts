// argus-loop: validate / run / resume / status for auto-loops.
//
//   argus-loop validate <loop>              expand and check a spec, print the full form
//   argus-loop run <loop> [--yes]           start a run (asks before starting unless --yes)
//                  [--no-wait]              at a human gate with no terminal, exit instead of
//                                           waiting for a decision from the Argus dashboard
//   argus-loop resume <loop> <run-id>       continue a run that stopped mid-way
//                     [--approve]           (approves the start of a run waiting after calibration)
//   argus-loop status <loop>                list runs and their best scores
//
// <loop> is a name under the loops folder (~/.agents-observe/loops, or
// $AGENTS_OBSERVE_LOOPS_DIR) or a path to a loop folder.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as journal from './journal'
import { runLoop } from './runner'
import { loadSpec } from './spec'

function loopsDir() {
  return process.env.AGENTS_OBSERVE_LOOPS_DIR ?? join(homedir(), '.agents-observe', 'loops')
}

function resolveLoop(arg: string | undefined): string {
  if (!arg) throw new Error('Missing <loop>.')
  const candidate = isAbsolute(arg) || arg.includes('/') || arg.includes('\\') ? resolve(arg) : join(loopsDir(), arg)
  if (!existsSync(join(candidate, 'spec.yaml'))) throw new Error(`No spec.yaml in ${candidate}.`)
  return candidate
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--fake-worker'))

  if (cmd === 'validate') {
    const home = resolveLoop(positional[0])
    const { spec, errors, warnings } = loadSpec(join(home, 'spec.yaml'))
    for (const w of warnings) console.log(`warning: ${w}`)
    if (!spec) {
      console.error(`invalid:\n- ${errors.join('\n- ')}`)
      process.exit(1)
    }
    console.log(JSON.stringify(spec, null, 2))
    return
  }

  if (cmd === 'run' || cmd === 'resume') {
    const home = resolveLoop(positional[0])
    const summary = await runLoop({
      loopHome: home,
      yes: args.includes('--yes'),
      approve: args.includes('--approve'),
      gateWait: args.includes('--no-wait') ? 'exit' : 'wait',
      fakeWorker: flag(args, '--fake-worker'),
      resumeRunId: cmd === 'resume' ? positional[1] : undefined,
    })
    if (cmd === 'resume' && !positional[1]) throw new Error('Usage: argus-loop resume <loop> <run-id>')
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  if (cmd === 'status') {
    const home = resolveLoop(positional[0])
    const runs = join(home, 'runs')
    const ids = existsSync(runs) ? readdirSync(runs).filter((d) => !d.startsWith('.')).sort() : []
    if (!ids.length) console.log('no runs yet')
    for (const id of ids) {
      const evs = journal.read(join(runs, id, 'journal.jsonl'))
      const fin = evs.find((e) => e.type === 'run_finished') as journal.RunFinishedEvent | undefined
      const its = journal.iterations(evs)
      const cal = evs.find((e) => e.type === 'calibration') as journal.CalibrationEvent | undefined
      const best = its.filter((i) => i.verdict === 'accepted').at(-1)?.scored ?? cal?.baseline
      const waiting = !fin && cal && !evs.some((e) => e.type === 'gate' && e.kind === 'start')
      console.log(
        `${id}  ${fin ? fin.reason : waiting ? 'awaiting_start' : 'unfinished'}  iterations ${its.length}  ` +
          `baseline ${cal?.baseline.value ?? '-'}  best ${best?.value ?? '-'}`,
      )
    }
    return
  }

  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 10).join('\n'))
  process.exit(cmd ? 1 : 0)
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`)
  process.exit(1)
})
