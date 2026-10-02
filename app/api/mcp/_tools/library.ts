import * as StatusRoute from '@/app/api/status/route'
import type { LibraryItemView } from '@/lib/game/types'
import { includesText, optStr, reqStr, type ToolImpls } from '@/lib/integration/tools/args'
import { findLibraryEntry, loadConfig, saveConfig, upsertLibraryEntry } from '@/services/game'

import { invokeRoute } from './route-invoke'

function gameView(item: LibraryItemView) {
  return {
    gameRoot: item.gameRoot,
    name: item.name,
    remark: item.remark ?? null,
    kind: item.kindLabel,
    missing: item.missing,
    remote: Boolean(item.remote),
    hasShell: item.hasShell,
    lastOpenedAt: item.lastOpenedAt,
  }
}

export const libraryTools: ToolImpls = {
  async chaya_library_list(args, { signal }) {
    const status = await invokeRoute(StatusRoute.GET, { method: 'GET', path: '/api/status', signal })
    const library = (status.library as LibraryItemView[] | undefined) ?? []
    const q = optStr(args, 'q')?.toLowerCase()
    const games = q ? library.filter((g) => includesText(g.name, q) || includesText(g.remark, q) || includesText(g.gameRoot, q)) : library
    const config = status.config as { gameRoot?: string } | undefined
    return { serviceMode: status.serviceMode, current: config?.gameRoot || null, total: library.length, matched: games.length, games: games.map(gameView) }
  },

  async chaya_library_bind(args, { signal }) {
    const gameRoot = reqStr(args, 'gameRoot')
    const res = await invokeRoute(StatusRoute.PUT, { method: 'PUT', path: '/api/status', body: { gameRoot }, signal })
    const config = res.config as { gameRoot?: string } | undefined
    return { current: config?.gameRoot || gameRoot, unchanged: Boolean(res.unchanged) }
  },

  async chaya_library_remark(args) {
    const gameRoot = reqStr(args, 'gameRoot')
    const remark = typeof args.remark === 'string' ? args.remark : null
    const prev = loadConfig()
    const existing = findLibraryEntry(prev.library, gameRoot)
    if (!existing) throw new Error(`游戏库中未找到：${gameRoot}`)
    const config = saveConfig({
      library: upsertLibraryEntry(prev.library, { gameRoot: existing.gameRoot, name: existing.name, remote: existing.remote, remark, touchOpen: false }),
    })
    const next = findLibraryEntry(config.library, existing.gameRoot)
    return { gameRoot: existing.gameRoot, remark: next?.remark ?? null }
  },

  async chaya_library_remove(args, { signal }) {
    const gameRoot = reqStr(args, 'gameRoot')
    const before = loadConfig().library.length
    const res = await invokeRoute(StatusRoute.DELETE, { method: 'DELETE', path: '/api/status', body: { gameRoot }, signal })
    const config = res.config as { gameRoot?: string; library?: unknown[] } | undefined
    const after = config?.library?.length ?? before
    if (after === before) throw new Error(`游戏库中未找到：${gameRoot}`)
    return { removed: gameRoot, current: config?.gameRoot || null, total: after }
  },
}
