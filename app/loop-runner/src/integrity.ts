// Integrity guards (design §7): what the worker changed, and whether the graders it must not
// touch are still byte-for-byte what the run started with.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** `**` matches any number of path segments, `*` anything within one segment. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (ch === '*') {
      re += '[^/]*'
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path))
}

export interface ChangeReview {
  /** Changed files under a protected pattern: an integrity violation. */
  protectedHits: string[]
  /** Changed files outside every editable pattern: the iteration is rejected, not punished. */
  outOfScope: string[]
}

export function reviewChanges(files: string[], editable: string[], protectedGlobs: string[]): ChangeReview {
  const protectedHits = files.filter((f) => matchesAny(f, protectedGlobs))
  const outOfScope = files.filter((f) => !protectedHits.includes(f) && !matchesAny(f, editable))
  return { protectedHits, outOfScope }
}

/** SHA-256 over every file under `root` (paths and contents, sorted) — or of a single file. */
export function hashTree(root: string): string {
  const h = createHash('sha256')
  const st = statSync(root)
  if (st.isFile()) {
    h.update(readFileSync(root))
    return h.digest('hex')
  }
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__pycache__') continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) files.push(p)
    }
  }
  walk(root)
  for (const f of files.sort()) {
    h.update(relative(root, f).replace(/\\/g, '/'))
    h.update('\0')
    h.update(readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex')
}
