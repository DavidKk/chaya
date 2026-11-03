import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { pathEquals } from '@/services/game/library'
import { anyRgssRunning, findRgssSessionByPid, quitRgss } from '@/services/game/rgss-runtime'
import { clearGamePresenceKeepQuit, requestGameQuit } from '@/services/runtime'

export type RunningGameProcess = {
  pid: number
  command: string
  isMain: boolean
  contentRoot?: string
}

let cachedProcesses: { timestamp: number; targetRoot?: string; results: RunningGameProcess[] } | null = null
const PROCESS_CACHE_TTL_MS = 1500

export function clearGameProcessCache() {
  cachedProcesses = null
}

function nwContentRootFromCommand(command: string): string | undefined {
  const args = command.match(/(?:^|[/\\])nwjs["']?\s+(.+)$/i)?.[1]
  if (!args) return undefined
  const explicit = args.match(/(?:^|\s)--nwapp-path(?:=|\s+)(.+)$/)?.[1]
  const value = (explicit || args).trim()
  // macOS ps does not quote argv, so splitting on spaces truncates game paths.
  const quoted = value.match(/^"([^"]+)"|^'([^']+)'/)
  const root = quoted ? quoted[1] || quoted[2] : value.split(/\s+--/)[0].trim()
  return root && !root.startsWith('-') && path.isAbsolute(root) ? path.resolve(root) : undefined
}

/**
 * Scan the operating system for active Chaya game processes (NW.js, mkxp-z, Game.exe, etc.).
 * Includes a short-lived cache (1.5s) to avoid repeatedly executing ps during rapid status polling.
 */
export function findRunningGameProcesses(targetContentRoot?: string): RunningGameProcess[] {
  const now = Date.now()
  if (cachedProcesses && now - cachedProcesses.timestamp < PROCESS_CACHE_TTL_MS && cachedProcesses.targetRoot === targetContentRoot) {
    return cachedProcesses.results
  }
  const results: RunningGameProcess[] = []

  if (process.platform === 'win32') {
    try {
      const stdout = execSync("wmic process where \"name like '%nw.exe%' or name like '%Game.exe%' or name like '%mkxp%'\" get ProcessId,CommandLine /format:csv", {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const lines = stdout.split('\r\n').filter(Boolean)
      for (const line of lines) {
        const parts = line.split(',')
        if (parts.length >= 3) {
          const cmd = parts[1] || ''
          const pid = parseInt(parts[2] || '0', 10)
          if (pid > 0 && !/wmic|node|grep/i.test(cmd)) {
            const isMain = !/--type=|helper|crashpad/i.test(cmd)
            results.push({ pid, command: cmd, isMain })
          }
        }
      }
    } catch {
      /* ignore wmic failures */
    }
    return results
  }

  // macOS / Linux
  try {
    const stdout = execSync('ps -eo pid,command', {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const lines = stdout.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const match = line.match(/^(\d+)\s+(.+)$/)
      if (!match) continue
      const pid = parseInt(match[1], 10)
      const cmd = match[2]

      // Ignore current Node scripts and search utilities
      if (/node|grep|ps -eo/i.test(cmd)) continue

      // Identify Chaya NW.js or RGSS mkxp-z processes
      const isNwShell = /Chaya\.app.*nwjs/i.test(cmd) || (/nwjs/i.test(cmd) && /app\.nw|--nwapp-path/i.test(cmd))
      const isRgss = /mkxp-z|mkxp/i.test(cmd)

      if (isNwShell || isRgss) {
        const isMain = !/Helper|crashpad|--type=/i.test(cmd)

        // Try to parse contentRoot from command line parameters
        let detectedRoot: string | undefined
        if (isMain && isNwShell) {
          detectedRoot = nwContentRootFromCommand(cmd)
        } else if (isMain && isRgss) {
          const matched = findRgssSessionByPid(pid)
          if (matched) {
            detectedRoot = matched.root
          } else {
            const match = cmd.match(/[\\/]rgss-runtime[\\/]games[\\/]([a-f0-9]+)[\\/]/i)
            if (match) {
              try {
                const sessionDir = cmd.slice(0, (match.index ?? 0) + match[0].length - 1)
                const logPath = path.join(sessionDir, 'runtime.log')
                if (fs.existsSync(logPath)) {
                  const content = fs.readFileSync(logPath, 'utf8')
                  const lines = content.split(/\r?\n/)
                  if (lines[1] && fs.existsSync(lines[1].trim())) {
                    detectedRoot = lines[1].trim()
                  }
                }
              } catch {}
            }
          }
        }

        if (targetContentRoot) {
          if (!detectedRoot || !pathEquals(detectedRoot, targetContentRoot)) {
            continue
          }
        }

        results.push({
          pid,
          command: cmd,
          isMain,
          contentRoot: detectedRoot,
        })
      }
    }
  } catch {
    /* ignore ps errors */
  }

  cachedProcesses = { timestamp: now, targetRoot: targetContentRoot, results }
  return results
}

/**
 * Check whether any game process is currently running (optionally filtered by contentRoot).
 */
export function isAnyGameProcessRunning(contentRoot?: string): boolean {
  if (contentRoot) {
    const list = findRunningGameProcesses(contentRoot)
    return list.length > 0
  }
  if (anyRgssRunning()) return true
  const list = findRunningGameProcesses()
  return list.length > 0
}

/**
 * Terminate all running game processes (called during game switching or shutdown).
 */
export async function terminateAllRunningGameProcesses(targetContentRoot?: string): Promise<{ killed: number[] }> {
  clearGameProcessCache()
  const killed: number[] = []

  // 1. RGSS runtime
  try {
    quitRgss(targetContentRoot || '')
  } catch {
    /* ignore */
  }

  // 2. Locate and terminate NW.js / shell processes
  const processes = findRunningGameProcesses(targetContentRoot)
  // Send SIGTERM to the main process first so it cleans up children naturally
  const sorted = [...processes].sort((a, b) => (a.isMain === b.isMain ? 0 : a.isMain ? -1 : 1))

  for (const proc of sorted) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore', timeout: 2000 })
      } else {
        process.kill(proc.pid, 'SIGTERM')
      }
      killed.push(proc.pid)
    } catch {
      /* process may already have exited */
    }
  }

  // 3. Verify if stubborn helper processes remain alive and escalate to SIGKILL
  if (killed.length > 0 && process.platform !== 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 350))
    for (const pid of killed) {
      try {
        process.kill(pid, 0)
        // Process still alive: force kill
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already dead */
      }
    }
  }

  // 4. Clean up Presence state only when no specific targetContentRoot was specified (global shutdown)
  if (!targetContentRoot) {
    clearGamePresenceKeepQuit()
    requestGameQuit()
  }

  return { killed }
}

/**
 * Terminate a single specific game process by PID (e.g. reclaiming an idle cloud instance).
 * Never triggers global requestGameQuit to ensure other local or running games are preserved.
 */
export async function terminateGameProcess(pid: number, contentRoot?: string): Promise<boolean> {
  clearGameProcessCache()
  if (contentRoot) {
    try {
      quitRgss(contentRoot)
    } catch {
      /* ignore */
    }
  }
  let killed = false
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', timeout: 2000 })
      killed = true
    } else {
      process.kill(pid, 'SIGTERM')
      killed = true
      setTimeout(() => {
        try {
          process.kill(pid, 0)
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      }, 350)
    }
  } catch {
    /* process may already be dead */
  }
  return killed
}
