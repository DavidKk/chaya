import * as LaunchRoute from '@/app/api/launch/route.server'
import * as PluginsRoute from '@/app/api/plugins/route.server'
import * as ShellRoute from '@/app/api/shell/route.server'
import * as StatusRoute from '@/app/api/status/route'
import * as WindowRoute from '@/app/api/window/route.server'
import { optBool, optObj, optStr, type ToolImpls } from '@/lib/integration/tools/args'

import { invokeRoute } from './route-invoke'

type StatusBody = Record<string, unknown> & {
  ready?: boolean
  error?: string
  selected?: string
  config?: { gameRoot?: string }
  plugins?: Array<{ name: string; registered: boolean; enabled: boolean; fileExists: boolean }>
  runtime?: { gameOnline?: boolean; apiBase?: string | null }
  nwPackage?: { name?: string; window?: { title?: string } } | null
}

function statusView(s: StatusBody) {
  if (!s.ready) return { ready: false, serviceMode: s.serviceMode, error: s.error || '尚未绑定游戏', gameRoot: s.config?.gameRoot || null }
  return {
    ready: true,
    serviceMode: s.serviceMode,
    gameRoot: s.selected,
    contentRoot: s.contentRoot,
    kind: s.kind,
    title: s.nwPackage?.window?.title || s.nwPackage?.name || null,
    remote: Boolean(s.remote),
    shell: { hasShell: Boolean(s.hasShell), bundled: Boolean(s.bundled), shellApp: s.shellApp ?? null },
    plugins: (s.plugins ?? []).map((p) => ({ name: p.name, installed: p.fileExists && p.registered, enabled: p.enabled })),
    pluginsReady: s.pluginsReady,
    pluginsTotal: s.pluginsTotal,
    translateCache: s.cache,
    sharedCache: s.sharedCache,
    footprint: s.footprint,
    gameOnline: Boolean(s.runtime?.gameOnline),
  }
}

export const gameTools: ToolImpls = {
  async chaya_game_status(_args, { signal }) {
    return statusView((await invokeRoute(StatusRoute.GET, { method: 'GET', path: '/api/status', signal })) as StatusBody)
  },

  async chaya_game_launch(_args, { signal }) {
    const res = await invokeRoute(LaunchRoute.POST, { method: 'POST', path: '/api/launch', signal })
    return { launched: true, mode: res.mode, path: res.path, apiBase: res.apiBase, plugins: res.plugins, hint: '游戏启动后约数秒 ChayaAgent 会连上，可用 chaya_live_games 确认。' }
  },

  async chaya_game_quit(_args, { signal }) {
    await invokeRoute(LaunchRoute.DELETE, { method: 'DELETE', path: '/api/launch', signal })
    return { quit: true }
  },

  async chaya_game_plugins_install(_args, { signal }) {
    return invokeRoute(PluginsRoute.POST, { method: 'POST', path: '/api/plugins', signal })
  },

  async chaya_game_plugins_clear(_args, { signal }) {
    return invokeRoute(PluginsRoute.DELETE, { method: 'DELETE', path: '/api/plugins', signal })
  },

  async chaya_game_shell_install(args, { signal }) {
    const shellSource = optStr(args, 'shellSource')
    const body = shellSource ? { shellSource, force: optBool(args, 'force') ?? false } : { fetchLatest: true }
    return invokeRoute(ShellRoute.POST, { method: 'POST', path: '/api/shell', body, signal })
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
    const status = (await invokeRoute(StatusRoute.GET, { method: 'GET', path: '/api/status', signal })) as StatusBody
    if (!status.ready || !status.selected) throw new Error(status.error || '尚未绑定游戏')
    return invokeRoute(WindowRoute.PUT, { method: 'PUT', path: '/api/window', body: { window, gameRoot: status.selected }, signal })
  },
}
