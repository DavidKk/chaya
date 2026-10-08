export const QUICK_SLOT_COUNT = 10
export const AUTO_INTERVAL_MIN_RANGE = { min: 1, max: 60 } as const
export const AUTO_MAX_COUNT_RANGE = { min: 15, max: 120 } as const

/** 存档存放位置：`game` 游戏目录（无文件系统时为该环境的浏览器存储）；`app` Chaya 本机服务的数据目录 */
export type GameSaveStorage = 'game' | 'app'

export type GameSavesSettings = {
  version: 1
  revision: number
  enabled: boolean
  intervalMin: number
  maxCount: number
  /** 快速存档是否开启；关闭时不能存入槽位，快捷键交给游戏，已有存档仍可加载、删除 */
  quickEnabled: boolean
  autoStorage: GameSaveStorage
  quickStorage: GameSaveStorage
}

export type GameSaveList = 'auto' | 'quick'
export type GameSaveTag = 'auto' | 'manual' | 'preload' | 'quick'
export type GameSaveSource = 'timer' | 'page' | 'hotkey'

export type GameSaveEntry = {
  id: string
  list: GameSaveList
  /** 0–9，仅快速存档 */
  slot?: number
  tag: GameSaveTag
  /** 在不可保存状态下强制保存 */
  unsafe: boolean
  savedAt: number
  playtimeFrames: number
  mapId: number
  mapName: string
  partyNames: string[]
  versionId: number
  engine: 'mv' | 'mz'
  bytes: number
  hasThumb: boolean
}

export type GameSavesIndex = {
  version: 1
  revision: number
  entries: GameSaveEntry[]
  /** 已从索引删除、内容文件尚待清理的条目 id；对账时删文件而不是当孤儿找回 */
  removing?: string[]
}

export type SaveWaitReason = 'notMap' | 'battle' | 'event' | 'message' | 'transfer' | 'moving' | 'menu' | 'idle' | 'busy' | 'offline'

export type GameSavesStatus = {
  enabled: boolean
  /** 距下次到期的剩余毫秒（按游戏有效运行时间）；未开启时为 null */
  nextDueInMs: number | null
  /** 是否正在累计（游戏窗口激活、在游戏中、浮层未打开）；为 false 时页面不按本地时钟递减 */
  counting: boolean
  waiting: SaveWaitReason | null
  busy: { op: 'save' | 'load'; entryId?: string } | null
  /** 存放位置读取失败（如 Chaya 本机服务未运行）的列表；页面刷新时重试 */
  offline: GameSaveList[]
}

export type GameSavesSnapshot = {
  settings: GameSavesSettings
  index: GameSavesIndex
  status: GameSavesStatus
  versionId: number
}

export type GameSavesOp =
  | { op: 'snapshot' }
  | { op: 'configure'; settings: GameSavesSettings; expectedRevision: number }
  | { op: 'save'; target: 'auto'; force?: boolean }
  | { op: 'save'; target: 'quick'; slot: number; force?: boolean; source?: 'page' | 'hotkey' }
  | { op: 'load'; entryId: string; allowVersionMismatch?: boolean; source?: 'page' | 'hotkey' }
  | { op: 'delete'; entryId: string }
  | { op: 'clear'; list: GameSaveList }
  | { op: 'thumb'; entryId: string }

/** 存到 Chaya 本机时，插件经 `POST /api/game-saves/store` 读写；内容为 gzip 字节的 base64 */
export type GameSavesAppStoreOp = { gameId: string } & (
  | { op: 'readIndex' }
  | { op: 'writeIndex'; index: GameSavesIndex; expectedRevision?: number }
  | { op: 'writeEntry'; list: GameSaveList; id: string; data: string; thumb: string | null }
  | { op: 'readEntry' | 'readThumb' | 'removeEntry'; list: GameSaveList; id: string }
  | { op: 'listEntries'; list: GameSaveList }
)

export type GameSavesErrorCode = 'unsafe' | 'busy' | 'empty' | 'versionMismatch' | 'stale' | 'failed'
