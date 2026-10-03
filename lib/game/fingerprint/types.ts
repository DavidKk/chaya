/** 游戏指纹：从游戏目录静态读出的引擎、插件、壳等信息（不启动游戏）。 */

export type EngineName = 'MZ' | 'MV' | 'unknown'

/** constant：`Utils.RPGMAKER_VERSION`；header：核心文件头注释；files：只凭文件名判断 */
export type EngineSource = 'constant' | 'header' | 'files' | 'none'

export type EngineLib = { name: string; version: string | null }

export type EngineInfo = {
  name: EngineName
  version: string | null
  source: EngineSource
  /** 命中的核心文件，如 `rmmz_core.js` */
  coreFiles: string[]
  /** `js/libs/` 下的第三方库（pixi、effekseer 等） */
  libs: EngineLib[]
}

/** `data/System.json` 中与识别相关的字段；不收集加密密钥本身 */
export type SystemInfo = {
  gameTitle?: string
  locale?: string
  versionId?: number
  encryptedImages: boolean
  encryptedAudio: boolean
  screenWidth?: number
  screenHeight?: number
}

export type PackageInfo = {
  /** 相对游戏项目根的 package.json 路径 */
  file: string
  name?: string
  main?: string
  title?: string
  width?: number
  height?: number
  chromiumArgs?: string
  jsFlags?: string
}

export type ShellRuntime = 'nwjs' | 'electron' | 'unknown'

export type ShellInfo = {
  runtime: ShellRuntime
  platform: 'mac' | 'windows' | 'linux'
  /** 相对游戏项目根的路径 */
  path: string
  /** NW.js 壳的 Chromium 版本（可用 nwjs.io/versions.json 换算 NW.js 版本） */
  chromium: string | null
  /** Chaya 自己装的壳，不是游戏原带的 */
  managed: boolean
}

export type PluginInfo = {
  /** plugins.js 中的 name，同时也是 `js/plugins/<name>.js` 的文件名 */
  name: string
  enabled: boolean
  /** plugins.js 中的 description（通常是 @plugindesc 的副本） */
  description?: string
  paramCount: number
  fileFound: boolean
  /** 插件系列：按文件名前缀 / 作者归类，如 VisuStella、Yanfly */
  family: string
  author?: string
  /** `@target`：MV / MZ */
  target: string[]
  version?: string
  url?: string
  /** `Imported.X = …` 注册的标识，插件之间靠它互相检测 */
  imported: string[]
  /** `@base` 依赖 */
  base: string[]
  chaya: boolean
}

export type PluginFamilyCount = { family: string; count: number }

export type PluginStats = {
  total: number
  enabled: number
  missingFiles: number
  families: PluginFamilyCount[]
}

export type GameFingerprint = {
  engine: EngineInfo
  system: SystemInfo | null
  package: PackageInfo | null
  shells: ShellInfo[]
  plugins: PluginInfo[]
  pluginStats: PluginStats
  collectedAt: number
}

/** 游戏库列表用的精简摘要 */
export type GameFingerprintSummary = {
  engine: EngineName
  engineVersion: string | null
  /** 不含 Chaya 自己的插件 */
  pluginCount: number
  enabledPluginCount: number
  /** 第三方插件系列（按数量降序，最多 3 个） */
  topFamilies: string[]
  encrypted: boolean
}
