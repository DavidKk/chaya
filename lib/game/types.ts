import {
  LEGACY_SHELL_APP_NAMES,
  PLUGIN_AGENT_NAME,
  PLUGIN_BOOST_NAME,
  PLUGIN_EDIT_NAME,
  PLUGIN_RUNTIME_NAME,
  PLUGIN_TRANS_NAME,
  SHELL_APP_NAME,
  SHELL_WIN_DIR_NAME,
} from '@/constants/brand'

import type { GameFingerprintSummary } from './fingerprint/types'
import type { UnsupportedEngine } from './unsupported-engine'

export { SHELL_APP_NAME, SHELL_WIN_DIR_NAME }

/** 游戏库条目（本地多游戏列表，当前选中仍用 gameRoot） */
export type LibraryEntry = {
  /** 稳定 UUID；历史曾用路径 base64url，加载时会迁移 */
  id: string
  gameRoot: string
  /** 识别到的原始名称（包名 / 路径） */
  name: string
  /** 用户备注；有则展示优先于 name */
  remark?: string
  /** 最近打开（切换/绑定）时间 */
  lastOpenedAt: number
  /** 首次加入库的时间（安装/添加） */
  addedAt: number
  /** 由局内心跳注册且本机无法解析路径（如虚拟机 / 远程） */
  remote?: boolean
}

/** 控制台库列表排序：名称（默认）/ 最后打开 / 安装时间 */
export type LibrarySortMode = 'name' | 'lastOpened' | 'addedAt'

/** 控制台库列表展示（含路径健康度与摘要） */
export type LibraryItemView = LibraryEntry & {
  missing: boolean
  kindLabel: string
  pathLabel: string
  hasShell: boolean
  /** 引擎 / 插件摘要；远程、路径失效或读不到时缺省 */
  fingerprint?: GameFingerprintSummary
}

export type ChayaConfig = {
  /** 当前选中的游戏路径（可能是 www、含 www 的发布根、或 .app） */
  gameRoot: string
  /** 干净 NW.js 壳源（macOS .app / Windows nw.exe 或其所在目录），安装到 data/shell/ */
  shellSource: string
  /** Steam 式游戏库列表 */
  library: LibraryEntry[]
}

export type ResolvedGame = {
  ok: true
  /** 用户选中的路径 */
  selected: string
  /** 含 index.html + data + js 的内容根 */
  contentRoot: string
  /** 游戏项目根（www 的上一级或内容根本身）；bundled 时为包根 / exe 所在目录 */
  projectRoot: string
  kind: 'content-root' | 'www' | 'app.nw' | 'remote'
  /** 启动用壳：共用 data/shell/…，或 bundled 时为 .app / Game.exe */
  shellApp: string
  hasShell: boolean
  hasWwwLayout: boolean
  /** 内容已在打包壳内：壳已就绪，跳过装壳，可做插件/翻译 */
  bundled: boolean
  /** 远程会话：本机不可读写内容根 */
  remote?: boolean
}

export type ResolveError = {
  ok: false
  error: string
  /** Detected engine other than MV / MZ */
  engine?: UnsupportedEngine
}

/** 由 ChayaLoader 动态拉取的跟踪插件（不含 Env / Loader） */
export type TrackedPlugin = typeof PLUGIN_RUNTIME_NAME | typeof PLUGIN_TRANS_NAME | typeof PLUGIN_EDIT_NAME | typeof PLUGIN_BOOST_NAME | typeof PLUGIN_AGENT_NAME

export const TRACKED_PLUGINS: readonly TrackedPlugin[] = [PLUGIN_RUNTIME_NAME, PLUGIN_TRANS_NAME, PLUGIN_EDIT_NAME, PLUGIN_BOOST_NAME, PLUGIN_AGENT_NAME] as const

/** 内容根旁可能存在的旧品牌壳名（解析回退） */
export const LEGACY_PROJECT_SHELL_NAMES = LEGACY_SHELL_APP_NAMES

export type PluginStatus = {
  name: TrackedPlugin
  registered: boolean
  enabled: boolean
  fileExists: boolean
  kitSource: string | null
}

export type PluginManifestEntry = {
  id: string
  name: string
  description: string
  source: string
  assemble?: string
  priority: number
}
