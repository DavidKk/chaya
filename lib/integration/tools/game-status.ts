/** `chaya_game_status` 的统一返回结构：本机 MCP 与网页版（Edge）WebMCP 各自取数，映射到同一形状。 */
import { formatBytes } from '@/lib/format-bytes'
import type { GameFingerprintSummary } from '@/lib/game/fingerprint/types'
import { countReadyPlugins } from '@/lib/game/plugins-status'
import type { PluginStatus } from '@/lib/game/types'

export type GameStatusOs = 'win' | 'mac' | 'linux' | 'other'
export type GameStatusKind = 'content-root' | 'www' | 'app.nw' | 'remote'

export type GameStatusNotReady = { ready: false; serviceMode: string; error: string; gameRoot: string | null }

export type GameStatusReady = {
  ready: true
  serviceMode: string
  /** 本机为绝对路径；网页版为游戏库条目的 gameRoot */
  gameRoot: string
  /** 备注优先，其次游戏库显示名 */
  name: string
  /** package.json 的窗口标题，其次包名 */
  title: string | null
  /** 本机为绝对路径；网页版为相对所选目录的显示路径 */
  contentRoot: string
  kind: GameStatusKind
  remote: boolean
  /** 运行游戏的系统：本机为服务所在系统，网页版为浏览器所在系统 */
  os: GameStatusOs
  shell: { hasShell: boolean; bundled: boolean; shellApp: string | null }
  plugins: Array<{ name: string; installed: boolean; enabled: boolean }>
  pluginsReady: number
  pluginsTotal: number
  translateCache: { entries: number; file: string | null; sizeBytes: number | null }
  /** 工具共享译文缓存统计；网页版没有共享缓存，为 null */
  sharedCache: unknown
  footprint: { contentBytes: number | null; contentLabel: string | null; shellBytes: number | null; shellLabel: string | null }
  fingerprint: GameFingerprintSummary | null
  gameOnline: boolean
}

export type GameStatusView = GameStatusNotReady | GameStatusReady

export function hostOs(platform: string): GameStatusOs {
  if (platform === 'win32') return 'win'
  if (platform === 'darwin') return 'mac'
  if (platform === 'linux') return 'linux'
  return 'other'
}

export function gameTitle(nwPackage: { name?: string; window?: { title?: string } } | null | undefined): string | null {
  return nwPackage?.window?.title || nwPackage?.name || null
}

export function pluginsView(plugins: readonly PluginStatus[]): Pick<GameStatusReady, 'plugins' | 'pluginsReady' | 'pluginsTotal'> {
  return {
    plugins: plugins.map((p) => ({ name: p.name, installed: p.fileExists && p.registered, enabled: p.enabled })),
    pluginsReady: countReadyPlugins(plugins),
    pluginsTotal: plugins.length,
  }
}

export function footprintView(contentBytes: number | null | undefined, shellBytes: number | null | undefined): GameStatusReady['footprint'] {
  return {
    contentBytes: contentBytes ?? null,
    contentLabel: formatBytes(contentBytes ?? null),
    shellBytes: shellBytes ?? null,
    shellLabel: formatBytes(shellBytes ?? null),
  }
}

type PluginsCounts = Pick<GameStatusReady, 'plugins' | 'pluginsReady' | 'pluginsTotal'>

/** `chaya_game_plugins_install` 的统一返回结构 */
export type GamePluginsInstallView = PluginsCounts & { installed: boolean; hint: string }
/** `chaya_game_plugins_clear` 的统一返回结构 */
export type GamePluginsClearView = PluginsCounts & { cleared: boolean }

export function pluginsInstallView(plugins: readonly PluginStatus[]): GamePluginsInstallView {
  const view = pluginsView(plugins)
  return { installed: view.pluginsTotal > 0 && view.pluginsReady === view.pluginsTotal, ...view, hint: '重启游戏后生效' }
}

export function pluginsClearView(plugins: readonly PluginStatus[]): GamePluginsClearView {
  const view = pluginsView(plugins)
  return { cleared: view.pluginsReady === 0, ...view }
}

/** `chaya_game_shell_install` 的统一返回结构；`pending` 表示还需要用户操作（选压缩包 / 手动下载） */
export type GameShellInstallView = {
  pending: boolean
  hasShell: boolean
  shellApp: string | null
  /** 网页版下载中心任务 id */
  taskId: string | null
  /** 需要用户手动下载时的地址 */
  downloadUrl: string | null
  hint: string
}

export function shellInstallView(view: Partial<GameShellInstallView> & Pick<GameShellInstallView, 'hasShell' | 'hint'>): GameShellInstallView {
  return { pending: false, shellApp: null, taskId: null, downloadUrl: null, ...view }
}
