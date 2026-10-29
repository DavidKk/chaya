import { type ChayaConfig, type ResolvedGame, type ResolveError, resolveGame } from '@/lib/game'
import { getGamePresence } from '@/services/runtime/presence'

import { loadConfig } from './config'
import { findLibraryEntry } from './library'

function remoteResolved(gameRoot: string, config: ChayaConfig): ResolvedGame & { config: ChayaConfig } {
  const presence = getGamePresence()
  return {
    ok: true,
    selected: gameRoot,
    contentRoot: presence.contentRoot || gameRoot,
    projectRoot: gameRoot,
    kind: 'remote',
    shellApp: '',
    hasShell: false,
    hasWwwLayout: false,
    bundled: false,
    remote: true,
    config,
  }
}

export function getResolvedFromConfig(options?: { gameId?: string; gameRoot?: string }): (ResolvedGame | ResolveError) & {
  config: ChayaConfig
} {
  const config = loadConfig()
  let targetRoot = options?.gameRoot
  if (!targetRoot && options?.gameId) {
    const entry = config.library.find((item) => item.id === options.gameId)
    if (entry) targetRoot = entry.gameRoot
  }
  if (!targetRoot) targetRoot = config.gameRoot
  if (!targetRoot) {
    return { ok: false, error: '', config }
  }

  const entry = findLibraryEntry(config.library, targetRoot)
  if (entry?.remote) {
    return remoteResolved(entry.gameRoot, config)
  }

  const resolved = resolveGame(targetRoot)
  if (resolved.ok) {
    return { ...resolved, remote: false, config }
  }
  return { ...resolved, config }
}
