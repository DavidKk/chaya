import path from 'node:path'

import { resolveGame } from '@/lib/game'
import { loadConfig } from '@/services/game/config'
import { findRunningGameProcesses, type RunningGameProcess } from '@/services/game/game-process'
import { pathEquals, toLibraryItemView } from '@/services/game/library'
import { findRgssSessionByPid } from '@/services/game/rgss-runtime'

type RunMode = 'local' | 'cloud'
type LaunchRecord = { mode: RunMode; pid?: number; recordedAt: number }
const STORE_KEY = '__chaya_game_launch_modes_v1__'

function launches(): Map<string, LaunchRecord> {
  const global = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, LaunchRecord> }
  return (global[STORE_KEY] ??= new Map())
}

function rootKey(root: string): string {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function recordGameLaunch(contentRoot: string, mode: RunMode): void {
  launches().set(rootKey(contentRoot), { mode, recordedAt: Date.now() })
}

export function gameRunMode(proc: RunningGameProcess): RunMode {
  if (!proc.contentRoot) return 'local'
  const key = rootKey(proc.contentRoot)
  const record = launches().get(key)
  if (!record) return 'local'
  // Bind provenance to the actual process, never to another launch of the same game.
  if ((record.pid !== undefined && record.pid !== proc.pid) || (record.pid === undefined && Date.now() - record.recordedAt > 60_000)) {
    launches().delete(key)
    return 'local'
  }
  record.pid = proc.pid
  return record.mode
}

export function playableGamesSnapshot() {
  const config = loadConfig()
  const processes = findRunningGameProcesses().filter((proc) => proc.isMain && proc.contentRoot)
  const library = config.library
    .map(toLibraryItemView)
    .filter((game) => !game.remote && !game.missing)
    .map((game) => {
      const resolved = resolveGame(game.gameRoot)
      const proc = resolved.ok ? processes.find((candidate) => pathEquals(candidate.contentRoot!, resolved.contentRoot)) : undefined
      return {
        ...game,
        running: proc ? { mode: gameRunMode(proc), pid: proc.pid, roomId: findRgssSessionByPid(proc.pid)?.session.roomId || game.id } : null,
      }
    })
  return { library, selected: config.gameRoot }
}
