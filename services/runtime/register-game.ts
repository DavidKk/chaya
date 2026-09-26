import path from 'node:path'

import { resolveGame } from '@/lib/game'
import { loadConfig, saveConfig } from '@/services/game/config'
import { findLibraryEntry, pathEquals, sameGameFamily, upsertLibraryEntry } from '@/services/game/library'

import { peekLaunchToken } from './launch-token'

export type RegisterGameInput = {
  gameRoot: string
  name?: string
  contentRoot?: string
  sessionId?: string
  /** 本机启动时 Env 写入的 token；无 token 只报在线，不改库 */
  launchToken?: string
}

export type RegisterGameResult = {
  registered: boolean
  selected: boolean
  gameRoot: string
  name: string
  remote?: boolean
  reason?: string
}

/** 同一会话只写库一次，避免心跳反复刷配置 */
const registeredSessions = new Set<string>()

function pruneRemoteDuplicates(library: ReturnType<typeof loadConfig>['library'], localRoot: string, localName: string): ReturnType<typeof loadConfig>['library'] {
  const name = localName.trim().toLowerCase()
  return library.filter((entry) => {
    if (!entry.remote) return true
    if (sameGameFamily(entry.gameRoot, localRoot)) return false
    if (name && entry.name.trim().toLowerCase() === name) return false
    return true
  })
}

/**
 * 插件主动上报入库。
 * - 有有效 launchToken：认作本机启动，绑到签发时的本地路径，绝不标远程
 * - 无 token：不改库（心跳仍可只更新在线）；避免「连上服务 = 远程」误入库导致双条目狂切
 */
export function registerGameFromPlugin(input: RegisterGameInput): RegisterGameResult {
  const session = peekLaunchToken(input.launchToken)
  if (!session?.gameRoot) {
    return {
      registered: false,
      selected: false,
      gameRoot: String(input.gameRoot || input.contentRoot || '').trim(),
      name: String(input.name || '').trim(),
      reason: 'unauthenticated',
    }
  }

  const gameRoot = session.gameRoot
  const nameHint = String(input.name || '').trim()
  const name = nameHint || path.basename(gameRoot.replace(/\\/g, '/')).replace(/\.app$/i, '') || '未命名游戏'
  const sessionKey = String(input.sessionId || `local:${session.token}`)

  if (registeredSessions.has(sessionKey)) {
    return {
      registered: false,
      selected: pathEquals(loadConfig().gameRoot, gameRoot),
      gameRoot,
      name,
      remote: false,
      reason: 'session-cached',
    }
  }

  const prev = loadConfig()
  const check = resolveGame(gameRoot)
  const remote = false
  const already = !!findLibraryEntry(prev.library, gameRoot)
  const currentEntry = findLibraryEntry(prev.library, prev.gameRoot)
  const currentHealthyLocal = !!(currentEntry && !currentEntry.remote && resolveGame(prev.gameRoot).ok)
  const shouldSelect = !currentHealthyLocal || pathEquals(prev.gameRoot, gameRoot)

  let library = upsertLibraryEntry(prev.library, { gameRoot, name, remote: false })
  library = pruneRemoteDuplicates(library, gameRoot, name)
  const nextRoot = shouldSelect ? gameRoot : prev.gameRoot
  const prevHit = findLibraryEntry(prev.library, gameRoot)
  const changed = !already || shouldSelect || !pathEquals(prev.gameRoot, nextRoot) || prevHit?.name !== name || !!prevHit?.remote || library.length !== prev.library.length

  if (changed) {
    saveConfig({
      gameRoot: nextRoot,
      library,
    })
  }

  registeredSessions.add(sessionKey)
  return {
    registered: !already || changed,
    selected: pathEquals(nextRoot, gameRoot),
    gameRoot,
    name,
    remote,
    reason: check.ok ? undefined : 'token-local-unresolved',
  }
}
