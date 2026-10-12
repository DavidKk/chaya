import { type ChildProcess, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { cliSearchDirs } from '@/services/integration/mcp-clients'

const PASSTHROUGH = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT']
const PROXY = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy']
const STDERR_LIMIT = 16 * 1024

const live = new Set<ChildProcess>()
let exitHookInstalled = false

/** Children never inherit Chaya's own secrets; only what a CLI needs to find node, home and the network. */
export function cliEnv(file: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const key of [...PASSTHROUGH, ...PROXY]) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  env.HOME ||= os.homedir()
  env.PATH = [path.dirname(file), ...cliSearchDirs()].join(path.delimiter)
  return { ...env, ...extra } as NodeJS.ProcessEnv
}

function installExitHook() {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const child of live) killCliTree(child)
  })
}

export function spawnCli(file: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd?: string }): ChildProcess {
  installExitHook()
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
  const child = shim
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', file, ...args], { env: options.env, cwd: options.cwd || os.tmpdir(), windowsHide: true })
    : spawn(file, args, { env: options.env, cwd: options.cwd || os.tmpdir(), detached: process.platform !== 'win32', windowsHide: true })
  live.add(child)
  child.once('exit', () => live.delete(child))
  child.once('error', () => live.delete(child))
  return child
}

/** CLIs spawn their own children; kill the whole group so nothing keeps the credentials directory busy. */
export function killCliTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

export class StderrBuffer {
  private text = ''

  push(chunk: Buffer | string) {
    this.text = (this.text + chunk.toString()).slice(-STDERR_LIMIT)
  }

  toString() {
    return this.text
  }
}

export type CliRunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean }

export function runCliOnce(file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal }): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(file, args, { env: options.env })
    let stdout = ''
    const stderr = new StderrBuffer()
    let timedOut = false
    const stop = () => killCliTree(child)
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', stop, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-STDERR_LIMIT * 4)
    })
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      resolve({ code, stdout, stderr: stderr.toString(), timedOut })
    })
  })
}
