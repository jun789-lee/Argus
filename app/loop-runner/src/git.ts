// The run's own worktree and branch: every iteration is a commit, so rejecting a candidate
// is a reset and the best version is always a ref.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './exec'

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await run('git', args, { cwd, timeoutMs: 120_000 })
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`)
  }
  return res.stdout.trim()
}

/** Keep `.worktrees/` out of the target repo's status without editing its .gitignore. */
function excludeWorktrees(repo: string) {
  const exclude = join(repo, '.git', 'info', 'exclude')
  if (!existsSync(join(repo, '.git'))) return
  mkdirSync(join(repo, '.git', 'info'), { recursive: true })
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!current.split(/\r?\n/).includes('.worktrees/')) {
    appendFileSync(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}.worktrees/\n`)
  }
}

export async function createWorktree(repo: string, baseRef: string, path: string, branch: string) {
  excludeWorktrees(repo)
  await git(repo, 'worktree', 'add', '-b', branch, path, baseRef)
  return git(path, 'rev-parse', 'HEAD')
}

export function head(worktree: string) {
  return git(worktree, 'rev-parse', 'HEAD')
}

/** Files that differ between `since` and the worktree as it is now (including new files). */
export async function changedFiles(worktree: string, since: string): Promise<string[]> {
  await git(worktree, 'add', '-A')
  const out = await git(worktree, 'diff', '--cached', '--name-only', since)
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
}

/** Commit whatever is staged (after changedFiles) and return the new HEAD. */
export async function commitAll(worktree: string, message: string): Promise<string> {
  await git(worktree, 'add', '-A')
  await git(
    worktree,
    '-c', 'user.name=argus-loop',
    '-c', 'user.email=argus-loop@localhost',
    'commit', '--allow-empty', '-q', '-m', message,
  )
  return head(worktree)
}

/** Put the worktree back exactly at `commit` (drops untracked files too). */
export async function resetTo(worktree: string, commit: string) {
  await git(worktree, 'reset', '-q', '--hard', commit)
  await git(worktree, 'clean', '-q', '-fd')
}
