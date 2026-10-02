import { clearCloudPlugins, type CloudGame, inspectCloudGame, installCloudPlugins, installCloudShell } from '@/lib/browser/cloud-prepare-game'
import type { ToolImpls } from '@/lib/integration/tools/types'

import { activeCloudEntry, ensureDirPermission, requireActiveGame, saveEntries } from './library'

export type EdgeGameDeps = {
  gameOnline: () => boolean
  quit: (reason?: string) => void
}

async function refreshEntry(id: string, game: CloudGame) {
  const { entries } = await activeCloudEntry()
  await saveEntries(entries.map((e) => (e.item.id === id ? { ...e, game, item: { ...e.item, hasShell: !!game.existingShell } } : e)))
}

/** Edge `chaya_game_*`: reads / writes through an already granted directory handle (never prompts). */
export function makeEdgeGameTools({ gameOnline, quit }: EdgeGameDeps): ToolImpls {
  async function inspectActive(mode: 'read' | 'readwrite') {
    const entry = await requireActiveGame()
    await ensureDirPermission(entry.game, mode)
    return { entry, game: await inspectCloudGame(entry.game) }
  }

  return {
    async chaya_game_status() {
      const { entry, game } = await inspectActive('read')
      return {
        ready: true,
        serviceMode: 'vercel',
        gameRoot: entry.item.gameRoot,
        name: entry.item.remark || entry.item.name,
        contentRoot: game.content.name,
        kind: game.content.name === 'www' ? 'www' : 'root',
        os: game.os,
        shell: { hasShell: !!game.existingShell, shellApp: game.existingShell ?? null },
        pluginsInstalled: game.pluginsInstalled,
        gameOnline: gameOnline(),
      }
    },

    async chaya_game_shell_check() {
      const { game } = await inspectActive('read')
      return {
        os: game.os,
        hasShell: !!game.existingShell,
        shellApp: game.existingShell ?? null,
        hint: game.existingShell ? '壳已存在；网页版不检查版本更新' : '未找到壳，可用 chaya_game_shell_install 安装（Windows）',
      }
    },

    async chaya_game_plugins_install() {
      const { entry } = await inspectActive('readwrite')
      await installCloudPlugins(entry.game, entry.item.id)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      return { installed: game.pluginsInstalled, hint: '重启游戏后生效' }
    },

    async chaya_game_plugins_clear() {
      const { entry } = await inspectActive('readwrite')
      await clearCloudPlugins(entry.game)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      return { cleared: !game.pluginsInstalled }
    },

    async chaya_game_shell_install() {
      const { entry } = await inspectActive('readwrite')
      const result = await installCloudShell(entry.game)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      return { ...result, hasShell: !!game.existingShell }
    },

    async chaya_game_quit() {
      if (!gameOnline()) throw new Error('游戏未连接')
      quit('webmcp')
      return { quit: true }
    },
  }
}
