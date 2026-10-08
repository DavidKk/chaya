import {
  AUTO_INTERVAL_MIN_RANGE,
  AUTO_MAX_COUNT_RANGE,
  type GameSaveEntry,
  type GameSaveList,
  type GameSavesIndex,
  type GameSavesSettings,
  type GameSaveStorage,
  QUICK_SLOT_COUNT,
  type SaveWaitReason,
} from './types'

export const DEFAULT_GAME_SAVES_SETTINGS: GameSavesSettings = {
  version: 1,
  revision: 0,
  enabled: false,
  intervalMin: 5,
  maxCount: 30,
  quickEnabled: false,
  autoStorage: 'game',
  quickStorage: 'game',
}

export function isGameSaveStorage(value: unknown): value is GameSaveStorage {
  return value === 'game' || value === 'app'
}

export function saveStorageOf(settings: GameSavesSettings, list: GameSaveList): GameSaveStorage {
  return list === 'quick' ? settings.quickStorage : settings.autoStorage
}

export const EMPTY_GAME_SAVES_INDEX: GameSavesIndex = { version: 1, revision: 0, entries: [] }

const ENTRY_ID = /^(?:quick-[0-9]|auto-[0-9a-z]{6,40})$/

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(range.max, Math.max(range.min, n))
}

export function parseGameSavesSettings(raw: unknown): GameSavesSettings {
  const src = raw && typeof raw === 'object' ? (raw as Partial<GameSavesSettings>) : {}
  const d = DEFAULT_GAME_SAVES_SETTINGS
  return {
    version: 1,
    revision: typeof src.revision === 'number' && src.revision >= 0 ? Math.floor(src.revision) : 0,
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    intervalMin: clampInt(src.intervalMin, AUTO_INTERVAL_MIN_RANGE, d.intervalMin),
    maxCount: clampInt(src.maxCount, AUTO_MAX_COUNT_RANGE, d.maxCount),
    quickEnabled: typeof src.quickEnabled === 'boolean' ? src.quickEnabled : d.quickEnabled,
    autoStorage: isGameSaveStorage(src.autoStorage) ? src.autoStorage : d.autoStorage,
    quickStorage: isGameSaveStorage(src.quickStorage) ? src.quickStorage : d.quickStorage,
  }
}

export type GameSavesSettingsIssue = { key: 'saves.error.invalidSettings' | 'saves.error.intervalRange' | 'saves.error.maxCountRange'; params?: { min: number; max: number } }

/** 设置校验：超出范围直接报错，不静默修正；返回文案 key，由调用方按界面语言翻译 */
export function validateGameSavesSettings(raw: unknown): GameSavesSettingsIssue | null {
  const s = raw as Partial<GameSavesSettings> | null
  if (!s || typeof s !== 'object') return { key: 'saves.error.invalidSettings' }
  const { min: iMin, max: iMax } = AUTO_INTERVAL_MIN_RANGE
  const { min: cMin, max: cMax } = AUTO_MAX_COUNT_RANGE
  if (!Number.isInteger(s.intervalMin) || s.intervalMin! < iMin || s.intervalMin! > iMax) return { key: 'saves.error.intervalRange', params: { min: iMin, max: iMax } }
  if (!Number.isInteger(s.maxCount) || s.maxCount! < cMin || s.maxCount! > cMax) return { key: 'saves.error.maxCountRange', params: { min: cMin, max: cMax } }
  if (typeof s.enabled !== 'boolean' || typeof s.quickEnabled !== 'boolean') return { key: 'saves.error.invalidSettings' }
  if (!isGameSaveStorage(s.autoStorage ?? 'game') || !isGameSaveStorage(s.quickStorage ?? 'game')) return { key: 'saves.error.invalidSettings' }
  return null
}

export function isGameSaveEntryId(id: unknown): id is string {
  return typeof id === 'string' && ENTRY_ID.test(id)
}

export function quickEntryId(slot: number): string {
  return `quick-${slot}`
}

export function isQuickSlot(slot: unknown): slot is number {
  return Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < QUICK_SLOT_COUNT
}

export function newAutoEntryId(now = Date.now(), random = Math.random): string {
  return `auto-${now.toString(36)}${Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`
}

function parseEntry(raw: unknown): GameSaveEntry | null {
  const e = raw as Partial<GameSaveEntry> | null
  if (!e || typeof e !== 'object' || !isGameSaveEntryId(e.id)) return null
  const list = e.list === 'quick' ? 'quick' : e.list === 'auto' ? 'auto' : null
  if (!list || (list === 'quick') !== e.id.startsWith('quick-')) return null
  if (list === 'quick' && (!isQuickSlot(e.slot) || e.id !== quickEntryId(e.slot))) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: e.id,
    list,
    ...(list === 'quick' ? { slot: e.slot } : {}),
    tag: e.tag === 'manual' || e.tag === 'preload' || e.tag === 'quick' ? e.tag : list === 'quick' ? 'quick' : 'auto',
    unsafe: e.unsafe === true,
    savedAt: num(e.savedAt),
    playtimeFrames: num(e.playtimeFrames),
    mapId: num(e.mapId),
    mapName: typeof e.mapName === 'string' ? e.mapName : '',
    partyNames: Array.isArray(e.partyNames) ? e.partyNames.filter((n): n is string => typeof n === 'string').slice(0, 4) : [],
    versionId: num(e.versionId),
    engine: e.engine === 'mz' ? 'mz' : 'mv',
    bytes: num(e.bytes),
    hasThumb: e.hasThumb === true,
  }
}

/** 索引外的内容文件（索引损坏或提交中断）补成最小条目；自动存档 id 前段是 base36 的保存时间 */
export function recoverOrphanEntry(list: GameSaveList, id: string): GameSaveEntry | null {
  if (!isGameSaveEntryId(id)) return null
  const savedAt = list === 'auto' ? parseInt(id.slice(5, -4), 36) : 0
  return parseEntry({ id, list, slot: list === 'quick' ? Number(id.slice(6)) : undefined, savedAt: Number.isFinite(savedAt) ? savedAt : 0, hasThumb: true })
}

export function parseGameSavesIndex(raw: unknown): GameSavesIndex {
  const src = raw as Partial<GameSavesIndex> | null
  if (!src || typeof src !== 'object' || !Array.isArray(src.entries)) return { ...EMPTY_GAME_SAVES_INDEX, entries: [] }
  const seen = new Set<string>()
  const entries: GameSaveEntry[] = []
  for (const item of src.entries) {
    const entry = parseEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  const removing = Array.isArray(src.removing) ? [...new Set(src.removing.filter((id) => isGameSaveEntryId(id) && !seen.has(id)))] : []
  return {
    version: 1,
    revision: typeof src.revision === 'number' && src.revision >= 0 ? Math.floor(src.revision) : 0,
    entries,
    ...(removing.length ? { removing } : {}),
  }
}

export function entryListOf(id: string): GameSaveList {
  return id.startsWith('quick-') ? 'quick' : 'auto'
}

export function autoEntries(index: GameSavesIndex): GameSaveEntry[] {
  return index.entries.filter((e) => e.list === 'auto').sort((a, b) => b.savedAt - a.savedAt)
}

export function quickSlots(index: GameSavesIndex): (GameSaveEntry | null)[] {
  const slots: (GameSaveEntry | null)[] = Array.from({ length: QUICK_SLOT_COUNT }, () => null)
  for (const e of index.entries) if (e.list === 'quick' && isQuickSlot(e.slot)) slots[e.slot] = e
  return slots
}

/** 轮换：自动列表超过上限时，从最早的开始删；`protect` 中的条目跳过 */
export function planRotation(index: GameSavesIndex, maxCount: number, protect: ReadonlySet<string> = new Set()): string[] {
  const auto = autoEntries(index)
  let excess = auto.length - maxCount
  if (excess <= 0) return []
  const removed: string[] = []
  for (let i = auto.length - 1; i >= 0 && excess > 0; i--) {
    if (protect.has(auto[i].id)) continue
    removed.push(auto[i].id)
    excess--
  }
  return removed
}

export function summarizeGameSaves(index: GameSavesIndex): { autoCount: number; autoBytes: number; quickUsed: number; quickBytes: number } {
  let autoCount = 0
  let autoBytes = 0
  let quickUsed = 0
  let quickBytes = 0
  for (const e of index.entries) {
    if (e.list === 'auto') {
      autoCount++
      autoBytes += e.bytes
    } else {
      quickUsed++
      quickBytes += e.bytes
    }
  }
  return { autoCount, autoBytes, quickUsed, quickBytes }
}

export const GAME_SAVES_WARN_BYTES = 1024 ** 3

/** 等待原因的文案 key（`saves.wait.*`） */
export function saveWaitReasonKey(reason: SaveWaitReason) {
  return `saves.wait.${reason}` as const
}

export const SAVE_INDEX_CONFLICT = 'INDEX_CONFLICT'

/** 写索引时磁盘上的版本已不是读到的那份：另一个窗口 / 进程先写了 */
export class SaveIndexConflictError extends Error {
  readonly code = SAVE_INDEX_CONFLICT
}

/** `expectedRevision` 省略时不核对；磁盘上没有索引按版本 0 算 */
export function assertIndexRevision(current: unknown, expectedRevision: number | undefined, message = 'Save index was changed elsewhere'): void {
  if (expectedRevision !== undefined && parseGameSavesIndex(current).revision !== expectedRevision) throw new SaveIndexConflictError(message)
}
