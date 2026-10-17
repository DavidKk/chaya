import type { IPty } from '@lydell/node-pty'

import { AgentCliError } from './errors'
import { trackLiveAgentProcess } from './live-processes.server'

export type PtyProcess = {
  write: (data: string) => void
  onData: (listener: (chunk: string) => void) => () => void
  exited: Promise<number>
  kill: () => void
}

export type PtySpawn = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; cols?: number; rows?: number }) => Promise<PtyProcess>

const live = new Set<IPty>()
let exitHookInstalled = false

function killTree(term: IPty) {
  try {
    // forkpty makes the child a session leader, so its pid is also its process group.
    if (process.platform !== 'win32') process.kill(-term.pid, 'SIGTERM')
    else term.kill()
  } catch {
    try {
      term.kill()
    } catch {
      /* Already gone. */
    }
  }
}

/** Interactive CLIs that refuse to run without a TTY (Antigravity login). The native module loads on first use only. */
export const spawnPty: PtySpawn = async (file, args, options) => {
  let pty: typeof import('@lydell/node-pty')
  try {
    pty = await import('@lydell/node-pty')
  } catch (error) {
    throw new AgentCliError('AGENT_CLI_CRASHED', `无法启动授权终端：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.once('exit', () => {
      for (const term of live) killTree(term)
    })
  }
  const term = pty.spawn(file, args, { name: 'xterm-256color', cols: options.cols ?? 120, rows: options.rows ?? 30, cwd: options.cwd, env: options.env })
  const kill = () => {
    if (live.has(term)) killTree(term)
  }
  const watch = trackLiveAgentProcess({ kind: 'pty', pid: term.pid, file, args, cwd: options.cwd, env: options.env, kill })
  live.add(term)
  const exited = new Promise<number>((resolve) => {
    term.onExit(({ exitCode }) => {
      live.delete(term)
      watch.dispose()
      resolve(exitCode)
    })
  })
  return {
    write: (data) => term.write(data),
    onData: (listener) => {
      const subscription = term.onData(listener)
      return () => subscription.dispose()
    },
    exited,
    kill,
  }
}
