// Stands in for a competition grader in tests. The candidate's score is the number in
// <candidate>/src/value.txt (lower is better). Special values:
//   not a number  -> the candidate is broken (ok: false)
//   999           -> the grader itself breaks (prints no verdict JSON)
//   $FAKE_GRADER_BREAK_AT -> same, while that env var names the value (lets a test fix it)
//   a file src/sealed_fail in the candidate -> the sealed check fails
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mode = args[args.indexOf('--mode') + 1]
const candidate = args[args.indexOf('--candidate') + 1]
const out = (v) => console.log(JSON.stringify(v))

let text = ''
try {
  text = readFileSync(join(candidate, 'src', 'value.txt'), 'utf8').trim()
} catch {
  out({ ok: false, metrics: {}, message: 'value.txt missing' })
  process.exit(0)
}
const value = Number(text)
if (!Number.isFinite(value)) {
  out({ ok: false, metrics: {}, message: `could not parse "${text}"` })
} else if (value === 999 || String(value) === process.env.FAKE_GRADER_BREAK_AT) {
  console.log('grader crashed')
} else if (mode === 'sealed') {
  const failed = existsSync(join(candidate, 'src', 'sealed_fail'))
  out({ ok: !failed, metrics: {}, message: failed ? 'sealed failure detail (must not leak)' : 'PASS' })
} else {
  out({ ok: true, metrics: { cost: value }, message: `cost ${value}` })
}
