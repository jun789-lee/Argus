// Stands in for Claude Code in tests. Reads the scenario file named by ARGUS_FAKE_SCENARIO
// (a JSON array, one step per iteration) and acts out step ARGUS_LOOP_ITERATION, then prints
// the same result JSON `claude -p --output-format json --json-schema` would.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const steps = JSON.parse(readFileSync(process.env.ARGUS_FAKE_SCENARIO, 'utf8'))
const n = Number(process.env.ARGUS_LOOP_ITERATION)
const step = steps[n - 1] ?? { noop: true }
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

if (step.sleep) await new Promise((r) => setTimeout(r, step.sleep))
if (step.set !== undefined) write('src/value.txt', String(step.set))
if (step.touch) write(step.touch, `touched by iteration ${n}\n`)
if (step.tamper) appendFileSync(step.tamper, '\n// tampered\n')

console.log(
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.01,
    structured_output: {
      hypothesis: step.hypothesis ?? `step ${n}: ${JSON.stringify(step)}`,
      change_summary: 'fake change',
      lesson: step.lesson,
      needs_human: !!step.needsHuman,
      needs_human_reason: step.needsHuman ? 'cannot proceed' : undefined,
    },
  }),
)
