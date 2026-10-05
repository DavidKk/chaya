import * as LaunchRoute from '@/app/api/launch/route.server'
import * as PluginsRoute from '@/app/api/plugins/route.server'
import * as ShellRoute from '@/app/api/shell/route.server'
import * as StatusRoute from '@/app/api/status/route'
import * as WindowRoute from '@/app/api/window/route.server'
import type { GameFingerprintSummary } from '@/lib/game/fingerprint/types'
import type { PluginStatus } from '@/lib/game/types'
import { optBool, optObj, optStr, type ToolImpls, type ToolRun } from '@/lib/integration/tools/args'
import {
  footprintView,
  type GamePluginsClearView,
  type GamePluginsInstallView,
  type GameShellInstallView,
  type GameStatusKind,
  type GameStatusView,
  gameTitle,
  hostOs,
  pluginsClearView,
  pluginsInstallView,
  pluginsView,
  shellInstallView,
} from '@/lib/integration/tools/game-status'
import { pathEquals } from '@/services/game'

import { invokeRoute } from './route-invoke'

type StatusBody = Record<string, unknown> & {
  ready?: boolean
  error?: string
  serviceMode?: string
  selected?: string
  contentRoot?: string
  kind?: GameStatusKind
  remote?: boolean
  hasShell?: boolean
  bundled?: boolean
  shellApp?: string | null
  config?: { gameRoot?: string }
  library?: Array<{ gameRoot: string; name?: string; remark?: string; fingerprint?: GameFingerprintSummary }>
  plugins?: PluginStatus[]
  cache?: { entries: number; file: string | null; sizeBytes: number | null }
  sharedCache?: unknown
  footprint?: { contentBytes: number | null; shellBytes: number | null }
  runtime?: { gameOnline?: boolean }
  host?: { platform?: string }
  nwPackage?: { name?: string; window?: { title?: string } } | null
}

async function readStatus(signal?: AbortSignal): Promise<StatusBody> {
  return (await invokeRoute(StatusRoute.GET, { method: 'GET', path: '/api/status', signal })) as StatusBody
}

function statusView(s: StatusBody): GameStatusView {
  const serviceMode = s.serviceMode || 'local'
  if (!s.ready || !s.selected) return { ready: false, serviceMode, error: s.error || '尚未绑定游戏', gameRoot: s.config?.gameRoot || null }
  const entry = s.library?.find((item) => pathEquals(item.gameRoot, s.selected!))
  return {
    ready: true,
    serviceMode,
    gameRoot: s.selected,
    name: entry?.remark || entry?.name || s.selected,
    title: gameTitle(s.nwPackage),
    contentRoot: s.contentRoot || s.selected,
    kind: s.kind || 'content-root',
    remote: Boolean(s.remote),
    os: hostOs(s.host?.platform || ''),
    shell: { hasShell: Boolean(s.hasShell), bundled: Boolean(s.bundled), shellApp: s.shellApp ?? null },
    ...pluginsView(s.plugins ?? []),
    translateCache: s.cache ?? { entries: 0, file: null, sizeBytes: null },
    sharedCache: s.sharedCache ?? null,
    footprint: footprintView(s.footprint?.contentBytes, s.footprint?.shellBytes),
    fingerprint: entry?.fingerprint ?? null,
    gameOnline: Boolean(s.runtime?.gameOnline),
  }
}

export const gameTools: ToolImpls = {
  async chaya_game_status(_args, { signal }) {
    return statusView(await readStatus(signal))
  },

  async chaya_game_launch(_args, { signal }) {
    const res = await invokeRoute(LaunchRoute.POST, { method: 'POST', path: '/api/launch', signal })
    return { launched: true, mode: res.mode, path: res.path, apiBase: res.apiBase, plugins: res.plugins, hint: '游戏启动后约数秒 ChayaAgent 会连上，可用 chaya_live_games 确认。' }
  },

  async chaya_game_plugins_install(_args, { signal }): Promise<GamePluginsInstallView> {
    await invokeRoute(PluginsRoute.POST, { method: 'POST', path: '/api/plugins', signal })
    return pluginsInstallView((await readStatus(signal)).plugins ?? [])
  },

  async chaya_game_plugins_clear(_args, { signal }): Promise<GamePluginsClearView> {
    await invokeRoute(PluginsRoute.DELETE, { method: 'DELETE', path: '/api/plugins', signal })
    return pluginsClearView((await readStatus(signal)).plugins ?? [])
  },

  async chaya_game_shell_install(args, { signal }): Promise<GameShellInstallView> {
    const shellSource = optStr(args, 'shellSource')
    const body = shellSource ? { shellSource, force: optBool(args, 'force') ?? false } : { fetchLatest: true, wait: true }
    const res = await invokeRoute(ShellRoute.POST, { method: 'POST', path: '/api/shell', body, signal })
    const shellApp = typeof res.shellApp === 'string' ? res.shellApp : null
    return shellInstallView({ hasShell: true, shellApp, hint: '壳已就绪，可用 chaya_game_launch 启动游戏' })
  },

  async chaya_game_shell_check(_args, { signal }) {
    return invokeRoute(ShellRoute.GET, { method: 'GET', path: '/api/shell', signal })
  },

  async chaya_game_shell_uninstall(_args, { signal }) {
    return invokeRoute(ShellRoute.DELETE, { method: 'DELETE', path: '/api/shell', signal })
  },

  async chaya_game_window(args, { signal }) {
    const window = optObj(args, 'window')
    if (!window) return invokeRoute(WindowRoute.GET, { method: 'GET', path: '/api/window', signal })
    const status = await readStatus(signal)
    if (!status.ready || !status.selected) throw new Error(status.error || '尚未绑定游戏')
    return invokeRoute(WindowRoute.PUT, { method: 'PUT', path: '/api/window', body: { window, gameRoot: status.selected }, signal })
  },
}

/** `chaya_live_quit` fallback on the local service: ask the launched game to quit */
export const quitLaunchedGame: ToolRun = async (_args, { signal }) => {
  await invokeRoute(LaunchRoute.DELETE, { method: 'DELETE', path: '/api/launch', signal })
  return { quit: true }
}
