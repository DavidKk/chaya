import path from 'node:path'

import type { ResolvedGame } from '@/lib/game'
import { loadConfig } from '@/services/game/config'
import { findLibraryEntry } from '@/services/game/library'

import { ensureChayaEnvInContent } from './env-inject'
import { issueLaunchToken } from './launch-token'

/** 为本机启动写入 Env + 签发 launchToken（心跳鉴权用） */
export function writeLaunchEnv(resolved: ResolvedGame, apiBase: string) {
  const config = loadConfig()
  const gameRoot = String(config.gameRoot || resolved.selected || '').trim()
  const entry = findLibraryEntry(config.library, gameRoot)
  const session = issueLaunchToken({
    gameRoot: gameRoot || path.resolve(resolved.selected),
    libraryId: entry?.id || '',
  })
  const env = ensureChayaEnvInContent(resolved.contentRoot, apiBase, {
    launchToken: session.token,
    // 与 Dashboard roomId（libraryId）对齐；无库 id 时退回 token，避免 Web/游戏各进各的房间
    gameId: session.libraryId || session.token,
  })
  return { env, session }
}
