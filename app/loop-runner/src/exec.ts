// Run a process with a hard timeout. On timeout the whole process tree is killed — on
// Windows a plain kill leaves the children (a worker's builds, wsl.exe) running.

import { spawn, spawnSync } from 'node:child_process'

export interface ExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export interface ExecOptions {
  cwd?: string
  timeoutMs: number
  input?: string
  env?: NodeJS.ProcessEnv
  /** Run `command` through the shell (for spec-provided command strings). */
  shell?: boolean
  /** Aborting kills the process tree (a stop request from the dashboard). */
  signal?: AbortSignal
}

function killTree(pid: number) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

export function run(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killTree(child.pid)
    }, opts.timeoutMs)
    const onAbort = () => {
      if (child.pid) killTree(child.pid)
    }
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      stderr += String(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - started })
    })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

/** The last non-empty line of `text` parsed as JSON, or null. */
export function lastJsonLine(text: string): unknown {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }
  return null
}
