import { execSync } from 'node:child_process'
import path from 'node:path'

import { pathEquals } from '@/services/game/library'
import { anyRgssRunning, quitRgss } from '@/services/game/rgss-runtime'
import { clearGamePresenceKeepQuit, requestGameQuit } from '@/services/runtime'

export type RunningGameProcess = {
  pid: number
  command: string
  isMain: boolean
  contentRoot?: string
}

/**
 * 扫描操作系统中正在运行的 Chaya 游戏进程（NW.js / mkxp-z / Game.exe 等）。
 */
export function findRunningGameProcesses(targetContentRoot?: string): RunningGameProcess[] {
  const results: RunningGameProcess[] = []

  if (process.platform === 'win32') {
    try {
      const stdout = execSync(
        'wmic process where "name like \'%nw.exe%\' or name like \'%Game.exe%\' or name like \'%mkxp%\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
      )
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

      // 忽略当前 Node/脚本进程
      if (/node|grep|ps -eo/i.test(cmd)) continue

      // 检测 Chaya NW.js 或 RGSS mkxp-z
      const isNwShell = /Chaya\.app.*nwjs/i.test(cmd) || (/nwjs/i.test(cmd) && /app\.nw|--nwapp-path/i.test(cmd))
      const isRgss = /mkxp-z|mkxp/i.test(cmd)

      if (isNwShell || isRgss) {
        const isMain = !/Helper|crashpad|--type=/i.test(cmd)

        // 尝试从命令行中提取 contentRoot
        let detectedRoot: string | undefined
        if (isMain && isNwShell) {
          // 主进程参数格式形如：.../nwjs /path/to/game/www
          const tokens = cmd.split(/\s+/)
          const lastToken = tokens[tokens.length - 1]
          if (lastToken && !lastToken.startsWith('-') && !lastToken.includes('nwjs')) {
            detectedRoot = path.resolve(lastToken)
          }
        }

        if (targetContentRoot && detectedRoot) {
          if (!pathEquals(detectedRoot, targetContentRoot)) {
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

  return results
}

/**
 * 判断是否有游戏进程正在运行（支持按 contentRoot 过滤）
 */
export function isAnyGameProcessRunning(contentRoot?: string): boolean {
  if (anyRgssRunning()) return true
  const list = findRunningGameProcesses(contentRoot)
  return list.length > 0
}

/**
 * 彻底关闭当前所有正在运行的游戏进程（切换游戏或关闭时调用）
 */
export async function terminateAllRunningGameProcesses(targetContentRoot?: string): Promise<{ killed: number[] }> {
  const killed: number[] = []

  // 1. RGSS runtime
  try {
    quitRgss(targetContentRoot || '')
  } catch {
    /* ignore */
  }

  // 2. 查找并杀掉 NW.js / shell 进程
  const processes = findRunningGameProcesses(targetContentRoot)
  // 优先给主进程发 SIGTERM，让其自然销毁子进程
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

  // 3. 稍后检查是否有顽固未退出的辅助进程，发送 SIGKILL
  if (killed.length > 0 && process.platform !== 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 350))
    for (const pid of killed) {
      try {
        process.kill(pid, 0)
        // 依然存活，强行杀死
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already dead */
      }
    }
  }

  // 4. 清理 Presence 状态
  clearGamePresenceKeepQuit()
  requestGameQuit()

  return { killed }
}
