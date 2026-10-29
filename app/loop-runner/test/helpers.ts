// Builds a throwaway target repo + loop folder for runner tests.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url)).replace(/\\/g, '/')
export const FAKE_WORKER = `node "${fixtures}fake-worker.mjs"`

export interface Sandbox {
  repo: string
  loopHome: string
  scenario: (steps: object[]) => void
}

export function sandbox(
  opts: { maxIterations?: number; plateau?: number; sealed?: boolean; workerTimeout?: string } = {},
): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'argus-loop-')).replace(/\\/g, '/')
  const repo = `${root}/repo`
  const loopHome = `${root}/loop`
  mkdirSync(`${repo}/src`, { recursive: true })
  mkdirSync(`${repo}/tests`, { recursive: true })
  writeFileSync(`${repo}/src/value.txt`, '100\n')
  writeFileSync(`${repo}/tests/fixed.txt`, 'protected\n')
  writeFileSync(`${repo}/README.md`, 'readme\n')
  const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  g('init', '-q')
  g('add', '-A')
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init')

  mkdirSync(`${loopHome}/verifiers/known_bad/src`, { recursive: true })
  writeFileSync(`${loopHome}/verifiers/known_bad/src/value.txt`, 'broken\n')
  writeFileSync(`${loopHome}/verifiers/check.txt`, 'grader fingerprint\n')
  const check = (mode: string) => `node "${fixtures}fake-check.mjs" --mode ${mode} --candidate {worktree}`
  const spec = [
    'version: 1',
    'class: ml-improve',
    'preset: optimization',
    'name: test-loop',
    'goal: { objective: "make cost lower" }',
    `workspace: { repo: "${repo}", editable: ["src/**"], protected: ["tests/**"] }`,
    `worker: { instructions: "lower the number in src/value.txt", timeout: ${opts.workerTimeout ?? '20s'} }`,
    'checks:',
    `  quick: { run: '${check('quick')}', timeout: 30s }`,
    `  score: { run: '${check('score')}', metric: cost, direction: minimize, timeout: 30s }`,
    ...(opts.sealed === false ? [] : [`  sealed: { run: '${check('sealed')}', timeout: 30s }`]),
    `known_bad: "${loopHome}/verifiers/known_bad"`,
    `budget: { max_iterations: ${opts.maxIterations ?? 5} }`,
    ...(opts.plateau ? [`overrides: { plateau_window: ${opts.plateau} }`] : []),
  ].join('\n')
  writeFileSync(`${loopHome}/spec.yaml`, spec)

  const scenarioPath = `${root}/scenario.json`
  process.env.ARGUS_FAKE_SCENARIO = scenarioPath
  return {
    repo,
    loopHome,
    scenario: (steps) => writeFileSync(scenarioPath, JSON.stringify(steps)),
  }
}
