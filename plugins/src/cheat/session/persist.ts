/**
 * In-game GameEdit persist: content-root `chaya/config/game-edit.json` (no Web service).
 */

import type { HotkeyMap } from '@/components/game-edit/run-hotkeys'
import { hotkeyMapsEqual, loadGlobalHotkeys, normalizeGameHotkeyMap, setGameHotkeysCache } from '@/components/game-edit/run-hotkeys'
import { emptySession, type RunFlagKey, type SessionState } from '@/components/game-edit/types'
import { gameContentRelPath, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'

import { detectGameIdentity } from '../../helpers/game/game-identity'
import { tryNodeFsPath } from '../../helpers/node/node-require'
import { applyGameSpeed, applyRunFlag, applySpeed } from '../runtime/apply-run'
import { Cheats, type LockKind } from '../runtime/cheats'
import { RunCheats } from '../runtime/cheats-run'

const FILE_REL = gameContentRelPath('gameEdit')
const LEGACY_NAMES = LEGACY_FLAT_FILES.gameEdit
const CHEAT_LOCK_KINDS = new Set<string>(['item', 'weapon', 'armor', 'var', 'gold', 'hp', 'mp', 'sw', 'level', 'exp'])

export type GameEditDiskRun = {
  walkRate?: number
  runRate?: number
  gameSpeed?: number
  expRate?: number
  fullscreen?: boolean
  alwaysDash?: boolean
  god?: boolean
  autoWin?: boolean
  through?: boolean
  autotalk?: boolean
  encounter?: boolean
  menuEnabled?: boolean
  saveEnabled?: boolean
  clickMove?: boolean
  followers?: boolean
  clickTeleport?: boolean
  resourceSkip?: boolean
}

export type GameEditDiskState = {
  version: 1
  run: GameEditDiskRun
  locks: Record<string, number>
  hotkeys: HotkeyMap
}

export function resolveGameEditDiskPath(): string | null {
  const mods = tryNodeFsPath()
  const id = detectGameIdentity()
  if (!mods || !id?.contentRoot) return null
  return mods.path.join(id.contentRoot, FILE_REL)
}

function resolveGameEditReadPath(): string | null {
  const mods = tryNodeFsPath()
  const id = detectGameIdentity()
  if (!mods || !id?.contentRoot) return null
  const primary = mods.path.join(id.contentRoot, FILE_REL)
  if (mods.fs.existsSync(primary)) return primary
  for (const name of LEGACY_NAMES) {
    const p = mods.path.join(id.contentRoot, name)
    if (mods.fs.existsSync(p)) return p
  }
  return null
}

function asFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  return undefined
}

function normalizeDisk(raw: unknown): GameEditDiskState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const runIn = o.run && typeof o.run === 'object' && !Array.isArray(o.run) ? (o.run as Record<string, unknown>) : {}
  const locksIn = o.locks && typeof o.locks === 'object' && !Array.isArray(o.locks) ? (o.locks as Record<string, unknown>) : {}
  const locks: Record<string, number> = {}
  for (const [k, v] of Object.entries(locksIn)) {
    const n = asFiniteNumber(v)
    if (n != null) locks[k] = n
  }
  const hotkeysRaw = o.hotkeys && typeof o.hotkeys === 'object' && !Array.isArray(o.hotkeys) ? (o.hotkeys as Record<string, unknown>) : {}
  const hotkeys = normalizeGameHotkeyMap(hotkeysRaw)
  return {
    version: 1,
    run: {
      walkRate: asFiniteNumber(runIn.walkRate),
      runRate: asFiniteNumber(runIn.runRate),
      gameSpeed: asFiniteNumber(runIn.gameSpeed),
      expRate: asFiniteNumber(runIn.expRate),
      fullscreen: asBool(runIn.fullscreen),
      alwaysDash: asBool(runIn.alwaysDash),
      god: asBool(runIn.god),
      autoWin: asBool(runIn.autoWin),
      through: asBool(runIn.through),
      autotalk: asBool(runIn.autotalk),
      encounter: asBool(runIn.encounter),
      menuEnabled: asBool(runIn.menuEnabled),
      saveEnabled: asBool(runIn.saveEnabled),
      clickMove: asBool(runIn.clickMove),
      followers: asBool(runIn.followers),
      clickTeleport: asBool(runIn.clickTeleport),
      resourceSkip: asBool(runIn.resourceSkip),
    },
    locks,
    hotkeys,
  }
}

export function loadGameEditDisk(): GameEditDiskState | null {
  const mods = tryNodeFsPath()
  const file = resolveGameEditReadPath()
  if (!mods || !file) return null
  try {
    if (!mods.fs.existsSync(file)) return null
    const raw = JSON.parse(mods.fs.readFileSync(file, 'utf8')) as unknown
    return normalizeDisk(raw)
  } catch {
    return null
  }
}

export function saveGameEditDisk(state: GameEditDiskState): boolean {
  const mods = tryNodeFsPath()
  const file = resolveGameEditDiskPath()
  if (!mods || !file) return false
  try {
    mods.fs.mkdirSync(mods.path.dirname(file), { recursive: true })
    const payload: GameEditDiskState = {
      version: 1,
      run: state.run || {},
      locks: state.locks || {},
      hotkeys: state.hotkeys || {},
    }
    mods.fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Extract disk-persistable fields from the current session */
export function diskStateFromSession(session: SessionState): GameEditDiskState {
  return {
    version: 1,
    run: {
      walkRate: session.walkRate,
      runRate: session.runRate,
      gameSpeed: session.gameSpeed,
      expRate: session.expRate,
      fullscreen: session.fullscreen,
      alwaysDash: session.alwaysDash,
      god: session.god,
      autoWin: session.autoWin,
      through: session.through,
      autotalk: session.autotalk,
      encounter: session.encounter,
      menuEnabled: session.menuEnabled,
      saveEnabled: session.saveEnabled,
      clickMove: session.clickMove,
      followers: session.followers,
      clickTeleport: session.clickTeleport,
      resourceSkip: session.resourceSkip,
    },
    locks: { ...session.locks },
    hotkeys: { ...session.hotkeys },
  }
}

function applyCheatLock(key: string, value: number) {
  const parts = key.split(':')
  if (parts.length < 2) return
  const kind = parts[0]
  if (!kind || !CHEAT_LOCK_KINDS.has(kind)) return
  const id = Number(parts[1])
  if (!Number.isFinite(id)) return
  Cheats.setLock(kind as LockKind, id, true, value)
}

/** Apply disk state to runtime (needs a loaded save with $gameParty) */
export function applyGameEditDisk(disk: GameEditDiskState) {
  if (!$gameParty) return
  Cheats.ensureHooks()
  RunCheats.ensureHooks()

  const run = disk.run || {}
  const walk = run.walkRate
  const runRate = run.runRate
  if (walk != null || runRate != null) applySpeed(walk ?? 1, runRate ?? 1)
  if (run.gameSpeed != null) applyGameSpeed(run.gameSpeed)
  if (run.expRate != null) RunCheats.setExpRate(run.expRate)

  const flags: RunFlagKey[] = [
    'fullscreen',
    'alwaysDash',
    'god',
    'autoWin',
    'through',
    'autotalk',
    'encounter',
    'menuEnabled',
    'saveEnabled',
    'clickMove',
    'followers',
    'clickTeleport',
    'resourceSkip',
  ]
  for (const key of flags) {
    const v = run[key]
    if (typeof v === 'boolean') applyRunFlag(key, v)
  }

  for (const [key, value] of Object.entries(disk.locks || {})) {
    applyCheatLock(key, value)
  }
}

/** Merge disk → session defaults */
export function mergeDiskIntoSession(prev: SessionState, disk: GameEditDiskState | null): SessionState {
  if (!disk) return prev
  const run = disk.run || {}
  return {
    ...prev,
    walkRate: run.walkRate ?? prev.walkRate,
    runRate: run.runRate ?? prev.runRate,
    gameSpeed: run.gameSpeed ?? prev.gameSpeed,
    expRate: run.expRate ?? prev.expRate,
    fullscreen: run.fullscreen ?? prev.fullscreen,
    alwaysDash: run.alwaysDash ?? prev.alwaysDash,
    god: run.god ?? prev.god,
    autoWin: run.autoWin ?? prev.autoWin,
    through: run.through ?? prev.through,
    autotalk: run.autotalk ?? prev.autotalk,
    encounter: run.encounter ?? prev.encounter,
    menuEnabled: run.menuEnabled ?? prev.menuEnabled,
    saveEnabled: run.saveEnabled ?? prev.saveEnabled,
    clickMove: run.clickMove ?? prev.clickMove,
    followers: run.followers ?? prev.followers,
    clickTeleport: run.clickTeleport ?? prev.clickTeleport,
    resourceSkip: run.resourceSkip ?? prev.resourceSkip,
    locks: { ...disk.locks, ...prev.locks },
    // 盘上有 hotkeys 字段则整表替换（含 {} = 已清空本游戏覆盖）
    hotkeys: { ...(disk.hotkeys || {}) },
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending: GameEditDiskState | null = null

export function scheduleSaveGameEditDisk(state: GameEditDiskState) {
  pending = state
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const next = pending
    pending = null
    if (!next) return
    saveGameEditDisk(next)
  }, 400)
}

/** Load: 本游戏覆盖来自盘；全局来自 localStorage；本游戏未设则运行时用全局 */
export function bootstrapGameEditSession(): SessionState {
  const disk = loadGameEditDisk()
  const hotkeysGlobal = loadGlobalHotkeys()
  let hotkeys: HotkeyMap = {}
  if (disk?.hotkeys && Object.keys(disk.hotkeys).length) {
    hotkeys = { ...disk.hotkeys }
    // 旧版盘上 hotkeys 常与 LS 整表同步；完全一致则视为无本游戏覆盖
    if (hotkeyMapsEqual(hotkeys, hotkeysGlobal)) hotkeys = {}
  }
  setGameHotkeysCache(hotkeys)
  const base = { ...emptySession(), hotkeys, hotkeysGlobal }
  if (!disk) return base
  // 用解析后的 hotkeys 覆盖盘上字段，避免 merge 把「去重后的空覆盖」又写回去
  return mergeDiskIntoSession(base, { ...disk, hotkeys })
}

let hadParty = false
let appliedForCurrentParty = false
let loadHooked = false

/** 读档后重新套用修改锁定；不经过 `DataManager.loadGame` 的读档（游戏存档）需显式调用 */
export function markGameEditNeedReapply() {
  appliedForCurrentParty = false
}

function hookLoadGame() {
  if (loadHooked) return
  const dm = (globalThis as { DataManager?: { loadGame?: (id: number) => boolean } }).DataManager
  if (!dm || typeof dm.loadGame !== 'function') return
  loadHooked = true
  const _load = dm.loadGame.bind(dm)
  dm.loadGame = (id: number) => {
    const ok = _load(id)
    if (ok) markGameEditNeedReapply()
    return ok
  }
}

/** Apply disk settings after entering / loading a save */
export function ensureGameEditDiskApplied() {
  hookLoadGame()
  if (!$gameParty) {
    hadParty = false
    appliedForCurrentParty = false
    return
  }
  if (!hadParty) {
    hadParty = true
    appliedForCurrentParty = false
  }
  if (appliedForCurrentParty) return
  const disk = loadGameEditDisk()
  if (disk) applyGameEditDisk(disk)
  appliedForCurrentParty = true
}

export function startGameEditDiskWatcher() {
  const disk = loadGameEditDisk()
  if (disk?.hotkeys) setGameHotkeysCache(disk.hotkeys)
  ensureGameEditDiskApplied()
  const id = window.setInterval(() => {
    try {
      ensureGameEditDiskApplied()
    } catch {
      /* */
    }
  }, 1500)
  return () => window.clearInterval(id)
}
