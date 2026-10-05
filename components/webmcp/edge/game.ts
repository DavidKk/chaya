import { clearCloudPlugins, type CloudGame, inspectCloudGame, installCloudPlugins, installCloudShell } from '@/lib/browser/cloud-prepare-game'
import { startCloudShellTask } from '@/lib/browser/cloud-shell-task'
import { writeCloudWindow } from '@/lib/browser/cloud-window'
import type { NwWindowConfig } from '@/lib/game/nw-window'
import { optObj } from '@/lib/integration/tools/args'
import {
  footprintView,
  type GamePluginsClearView,
  type GamePluginsInstallView,
  type GameShellInstallView,
  type GameStatusView,
  gameTitle,
  pluginsClearView,
  pluginsInstallView,
  pluginsView,
  shellInstallView,
} from '@/lib/integration/tools/game-status'
import type { ToolImpls } from '@/lib/integration/tools/types'

import { activeCloudEntry, ensureDirPermission, requireActiveGame, saveEntries } from './library'

export type EdgeGameDeps = {
  gameOnline: () => boolean
  quit: (reason?: string) => void
  /** `/api/status` 报告的服务形态（与本机 MCP 的 serviceMode 同源） */
  serviceMode: string
}

async function refreshEntry(id: string, game: CloudGame) {
  const { entries } = await activeCloudEntry()
  await saveEntries(entries.map((e) => (e.item.id === id ? { ...e, game, item: { ...e.item, hasShell: !!game.existingShell } } : e)))
}

/** Edge `chaya_game_*`: reads / writes through an already granted directory handle (never prompts). */
export function makeEdgeGameTools({ gameOnline, quit, serviceMode }: EdgeGameDeps): ToolImpls {
  async function inspectActive(mode: 'read' | 'readwrite') {
    const entry = await requireActiveGame()
    await ensureDirPermission(entry.game, mode)
    return { entry, game: await inspectCloudGame(entry.game) }
  }

  return {
    async chaya_game_status(): Promise<GameStatusView> {
      const { active } = await activeCloudEntry()
      if (!active) return { ready: false, serviceMode, error: '浏览器游戏库为空：请用户在游戏库页面点击「添加游戏」选择目录', gameRoot: null }
      await ensureDirPermission(active.game, 'read')
      const game = await inspectCloudGame(active.game)
      const { item } = active
      const nested = game.content !== game.picked
      return {
        ready: true,
        serviceMode,
        gameRoot: item.gameRoot,
        name: item.remark || item.name,
        title: gameTitle(game.nwPackage),
        contentRoot: nested ? `${game.picked.name}/${game.content.name}` : game.picked.name,
        kind: nested && game.content.name === 'www' ? 'www' : 'content-root',
        remote: false,
        os: game.os,
        shell: { hasShell: !!game.existingShell, bundled: false, shellApp: game.existingShell ?? null },
        ...pluginsView(game.plugins ?? []),
        translateCache: { entries: game.cacheEntries ?? 0, file: null, sizeBytes: null },
        sharedCache: null,
        footprint: footprintView(game.footprint?.contentBytes, game.footprint?.shellBytes),
        fingerprint: game.fingerprint ?? null,
        gameOnline: gameOnline(),
      }
    },

    async chaya_game_window(args) {
      const window = optObj(args, 'window')
      const { entry, game } = await inspectActive(window ? 'readwrite' : 'read')
      if (!window) {
        if (!game.nwPackage) throw new Error(`内容根缺少 package.json: ${game.content.name}`)
        return { package: game.nwPackage }
      }
      const nwPackage = await writeCloudWindow(entry.game.content, window as Partial<NwWindowConfig>, entry.game.picked.name)
      await refreshEntry(entry.item.id, { ...game, nwPackage })
      return { package: nwPackage }
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

    async chaya_game_plugins_install(): Promise<GamePluginsInstallView> {
      const { entry } = await inspectActive('readwrite')
      await installCloudPlugins(entry.game, entry.item.id)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      return pluginsInstallView(game.plugins ?? [])
    },

    async chaya_game_plugins_clear(): Promise<GamePluginsClearView> {
      const { entry } = await inspectActive('readwrite')
      await clearCloudPlugins(entry.game)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      return pluginsClearView(game.plugins ?? [])
    },

    async chaya_game_shell_install(): Promise<GameShellInstallView> {
      const { entry } = await inspectActive('readwrite')
      if (entry.game.os === 'win') {
        const task = await startCloudShellTask(entry)
        if ('error' in task) throw new Error('另一个页面正在为此游戏安装壳')
        if (await task.needsFile) {
          return shellInstallView({
            pending: true,
            hasShell: false,
            taskId: task.id,
            hint: '已创建装壳任务（进度见右上角下载中心）：请用户下载官方压缩包后，在游戏卡片点「选择已下载的压缩包」（Agent 调用无法弹出文件选择框）',
          })
        }
        const finished = await task.done
        if (finished.status !== 'done') throw new Error(finished.error || '装壳已取消')
        const game = await inspectCloudGame(entry.game)
        return shellInstallView({ hasShell: !!game.existingShell, shellApp: game.existingShell ?? null, hint: '壳已就绪。双击启动脚本启动游戏。' })
      }
      const { hint, downloadUrl } = await installCloudShell(entry.game)
      const game = await inspectCloudGame(entry.game)
      await refreshEntry(entry.item.id, game)
      const hasShell = !!game.existingShell
      return shellInstallView({ pending: !hasShell, hasShell, shellApp: game.existingShell ?? null, downloadUrl: downloadUrl ?? null, hint })
    },

    /** Overrides the in-game `game.quit`: the page asks the linked game to exit */
    async chaya_live_quit() {
      if (!gameOnline()) throw new Error('游戏未连接')
      quit('webmcp')
      return { quit: true }
    },
  }
}
