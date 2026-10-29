#!/usr/bin/env node
// Thin launcher so `argus-loop` works without a build step: runs src/cli.ts through tsx.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const result = spawnSync(process.execPath, [tsx, join(root, 'src', 'cli.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
