import type { RunActionId, RunFlagKey } from '@/components/game-edit/types'
import type { ToolPanelId } from '@/components/game-tools/tool-panels'
import type { MessageKey } from '@/lib/i18n'

export type HotkeyKind = 'flag' | 'action' | 'ui' | 'save'

export type HotkeyTarget = {
  id: string
  kind: HotkeyKind
  /** flag key / action id / ui 动作名 */
  target: string
  labelKey: MessageKey
  /** labelKey 的插值参数（如快速存档槽号） */
  labelParams?: Record<string, string | number>
  descKey: MessageKey
  groupKey: MessageKey
}

/** 唤出 / 关闭局内作弊面板；必须始终有绑定 */
export const OPEN_PANEL_HOTKEY_ID = 'ui:toggle'
/** 默认唤出键（反引号） */
export const DEFAULT_OPEN_PANEL_CHORD = '`'

/** 打开游戏 DevTools 控制台（跟 Chrome 默认一致，按系统区分） */
export const OPEN_CONSOLE_HOTKEY_ID = 'ui:console'

/**
 * Chrome DevTools 默认：
 * - macOS：⌥⌘I → 内部串记为 Ctrl+Alt+I（Meta 与 Ctrl 同记）
 * - Windows / Linux：Ctrl+Shift+J
 */
export function defaultOpenConsoleChord(): string {
  if (isApplePlatform()) return 'Ctrl+Alt+I'
  return 'Ctrl+Shift+J'
}

/** 曾短暂用过的 mac 默认，加载时迁到当前默认 */
const LEGACY_MAC_OPEN_CONSOLE_CHORD = 'Ctrl+Alt+J'

function isApplePlatform(): boolean {
  if (typeof process !== 'undefined' && process.platform === 'darwin') return true
  if (typeof navigator !== 'undefined') {
    const platform = navigator.platform || ''
    const ua = navigator.userAgent || ''
    if (/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua)) return true
  }
  return false
}

/**
 * 展示用：macOS 把 Ctrl/Alt/Shift 写成 ⌘⌥⇧（存储仍为 Ctrl+…）。
 * 例：Ctrl+Alt+I → ⌥⌘I
 */
export function displayKeyChord(chord: string): string {
  const t = String(chord ?? '').trim()
  if (!t || !isApplePlatform()) return t
  const parts = t
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  let ctrl = false
  let alt = false
  let shift = false
  const keys: string[] = []
  for (const p of parts) {
    const l = p.toLowerCase()
    if (l === 'ctrl' || l === 'control' || l === 'meta' || l === 'cmd' || l === 'command') ctrl = true
    else if (l === 'alt' || l === 'option' || l === 'opt') alt = true
    else if (l === 'shift') shift = true
    else keys.push(p.length === 1 ? p.toUpperCase() : p)
  }
  if (!ctrl && !alt && !shift) return t
  // Apple 修饰键习惯顺序：⌥ ⇧ ⌘（存储的 Ctrl 在 Mac 上展示为 ⌘）
  let out = ''
  if (alt) out += '⌥'
  if (shift) out += '⇧'
  if (ctrl) out += '⌘'
  out += keys.join('')
  return out
}

export type HotkeyMap = Record<string, string>

/** 读取单表中的唤出键；空或未设时回到 ` */
export function resolveOpenPanelChord(map?: HotkeyMap | null): string {
  const v = String(map?.[OPEN_PANEL_HOTKEY_ID] ?? '').trim()
  return v || DEFAULT_OPEN_PANEL_CHORD
}

/** 读取单表中的控制台键；空或未设时回到系统 Chrome 默认 */
export function resolveOpenConsoleChord(map?: HotkeyMap | null): string {
  let v = String(map?.[OPEN_CONSOLE_HOTKEY_ID] ?? '').trim()
  if (isApplePlatform() && v.toLowerCase() === LEGACY_MAC_OPEN_CONSOLE_CHORD.toLowerCase()) {
    v = ''
  }
  return v || defaultOpenConsoleChord()
}

/** 快速存档槽 0–9：保存 `save:quick:N` 默认 Ctrl+N，读取 `load:quick:N` 默认 Alt+N */
export const QUICK_SAVE_SLOTS = 10

export function quickSaveHotkeyId(action: 'save' | 'load', slot: number): string {
  return `${action}:quick:${slot}`
}

export function parseQuickSaveHotkeyId(id: string): { action: 'save' | 'load'; slot: number } | null {
  const m = /^(save|load):quick:([0-9])$/.exec(id)
  return m ? { action: m[1] as 'save' | 'load', slot: Number(m[2]) } : null
}

let pendingHotkeyGroup: MessageKey | null = null

/** 跳到快捷键页前登记目标分组；Web 路由跳转与局内浮层切分区都在同一页面内，模块状态可跨组件传递 */
export function requestHotkeyGroupFocus(groupKey: MessageKey): void {
  pendingHotkeyGroup = groupKey
}

/** 快捷键页挂载时取出一次性的目标分组 */
export function takeHotkeyGroupFocus(): MessageKey | null {
  const groupKey = pendingHotkeyGroup
  pendingHotkeyGroup = null
  return groupKey
}

/** 系统默认绑定：唤出键、控制台、快速存档；其余为空 */
export function defaultHotkeyChord(id: string): string {
  if (id === OPEN_PANEL_HOTKEY_ID) return DEFAULT_OPEN_PANEL_CHORD
  if (id === OPEN_CONSOLE_HOTKEY_ID) return defaultOpenConsoleChord()
  const quick = parseQuickSaveHotkeyId(id)
  if (quick) return `${quick.action === 'save' ? 'Ctrl' : 'Alt'}+${quick.slot}`
  return ''
}

/**
 * 有效绑定：本游戏有值用本游戏，否则用全局；唤出/控制台再缺省则系统默认。
 */
export function resolveHotkeyChord(id: string, game?: HotkeyMap | null, global?: HotkeyMap | null): string {
  const g = String(game?.[id] ?? '').trim()
  if (g) return g
  const gl = String(global?.[id] ?? '').trim()
  if (gl) return gl
  return defaultHotkeyChord(id)
}

/** 合并后的有效表（匹配用）；本游戏覆盖全局；同一组合键只保留一个 id（本游戏优先）；快速存档默认值优先级最低 */
export function effectiveHotkeys(game?: HotkeyMap | null, global?: HotkeyMap | null): HotkeyMap {
  const chordOwner = new Map<string, string>()
  const out: HotkeyMap = {}

  const place = (id: string, chord: string) => {
    const t = chord.trim()
    if (!t) return
    const key = t.toLowerCase()
    const prev = chordOwner.get(key)
    if (prev && prev !== id) delete out[prev]
    out[id] = t
    chordOwner.set(key, id)
  }

  for (let slot = 0; slot < QUICK_SAVE_SLOTS; slot++) {
    for (const action of ['save', 'load'] as const) {
      const id = quickSaveHotkeyId(action, slot)
      if (!String(game?.[id] ?? '').trim() && !String(global?.[id] ?? '').trim()) place(id, defaultHotkeyChord(id))
    }
  }
  for (const [id, chord] of Object.entries(global || {})) place(id, chord)
  for (const [id, chord] of Object.entries(game || {})) place(id, chord)

  const panel = resolveHotkeyChord(OPEN_PANEL_HOTKEY_ID, game, global)
  place(OPEN_PANEL_HOTKEY_ID, panel)
  const consoleChord = resolveHotkeyChord(OPEN_CONSOLE_HOTKEY_ID, game, global)
  place(OPEN_CONSOLE_HOTKEY_ID, consoleChord)
  return out
}

/** 两表键值是否一致（忽略空串、大小写） */
export function hotkeyMapsEqual(a?: HotkeyMap | null, b?: HotkeyMap | null): boolean {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const k of keys) {
    const av = String(a?.[k] ?? '')
      .trim()
      .toLowerCase()
    const bv = String(b?.[k] ?? '')
      .trim()
      .toLowerCase()
    if (av !== bv) return false
  }
  return true
}

/** 与运行页开关一致，可供快捷键绑定 */
export const RUN_FLAG_HOTKEY_ROWS: ReadonlyArray<{ key: RunFlagKey; labelKey: MessageKey; descKey: MessageKey }> = [
  { key: 'fullscreen', labelKey: 'edit.flagFullscreen', descKey: 'edit.flagFullscreenDesc' },
  { key: 'alwaysDash', labelKey: 'edit.flagAlwaysDash', descKey: 'edit.flagAlwaysDashDesc' },
  { key: 'god', labelKey: 'edit.flagGod', descKey: 'edit.flagGodDesc' },
  { key: 'through', labelKey: 'edit.flagThrough', descKey: 'edit.flagThroughDesc' },
  { key: 'autotalk', labelKey: 'edit.flagAutotalk', descKey: 'edit.flagAutotalkDesc' },
  { key: 'encounter', labelKey: 'edit.flagEncounter', descKey: 'edit.flagEncounterDesc' },
  { key: 'menuEnabled', labelKey: 'edit.flagMenu', descKey: 'edit.flagMenuDesc' },
  { key: 'saveEnabled', labelKey: 'edit.flagSave', descKey: 'edit.flagSaveDesc' },
  { key: 'clickMove', labelKey: 'edit.flagClickMove', descKey: 'edit.flagClickMoveDesc' },
  { key: 'followers', labelKey: 'edit.flagFollowers', descKey: 'edit.flagFollowersDesc' },
  { key: 'clickTeleport', labelKey: 'edit.flagClickTeleport', descKey: 'edit.flagClickTeleportDesc' },
  { key: 'resourceSkip', labelKey: 'edit.flagResourceSkip', descKey: 'edit.flagResourceSkipDesc' },
]

const ACTION_HOTKEY_ITEMS: ReadonlyArray<{ id: RunActionId; labelKey: MessageKey; descKey: MessageKey; groupKey: MessageKey }> = [
  { id: 'scene:status', labelKey: 'edit.actStatus', descKey: 'edit.actStatusDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:equip', labelKey: 'edit.actEquip', descKey: 'edit.actEquipDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:skill', labelKey: 'edit.actSkill', descKey: 'edit.actSkillDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:item', labelKey: 'edit.actItem', descKey: 'edit.actItemDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:menu', labelKey: 'edit.actMenu', descKey: 'edit.actMenuDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:load', labelKey: 'edit.actLoad', descKey: 'edit.actLoadDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:save', labelKey: 'edit.actSave', descKey: 'edit.actSaveDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:options', labelKey: 'edit.actOptions', descKey: 'edit.actOptionsDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:debug', labelKey: 'edit.actDebug', descKey: 'edit.actDebugDesc', groupKey: 'edit.groupScene' },
  { id: 'scene:pop', labelKey: 'edit.actPop', descKey: 'edit.actPopDesc', groupKey: 'edit.groupScene' },
  { id: 'fix:clearPictures', labelKey: 'edit.actClearPictures', descKey: 'edit.actClearPicturesDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:clearEvent', labelKey: 'edit.actClearEvent', descKey: 'edit.actClearEventDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:clearMoveRoute', labelKey: 'edit.actClearMove', descKey: 'edit.actClearMoveDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:closeWindows', labelKey: 'edit.actCloseWindows', descKey: 'edit.actCloseWindowsDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:title', labelKey: 'edit.actTitle', descKey: 'edit.actTitleDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:map', labelKey: 'edit.actMap', descKey: 'edit.actMapDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:fadeIn', labelKey: 'edit.actFadeIn', descKey: 'edit.actFadeInDesc', groupKey: 'edit.groupFix' },
  { id: 'fix:resume', labelKey: 'edit.actResume', descKey: 'edit.actResumeDesc', groupKey: 'edit.groupFix' },
  { id: 'battle:victory', labelKey: 'edit.actVictoryLong', descKey: 'edit.actVictoryDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:escape', labelKey: 'edit.actEscapeLong', descKey: 'edit.actEscapeDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:defeat', labelKey: 'edit.actDefeatLong', descKey: 'edit.actDefeatDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:abort', labelKey: 'edit.actAbortLong', descKey: 'edit.actAbortDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:enemyHp1', labelKey: 'edit.actEnemyHp1Long', descKey: 'edit.actEnemyHp1Desc', groupKey: 'edit.groupBattle' },
  { id: 'battle:enemyHpMax', labelKey: 'edit.actEnemyHpMaxLong', descKey: 'edit.actEnemyHpMaxDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:partyHeal', labelKey: 'edit.actPartyHealLong', descKey: 'edit.actPartyHealDesc', groupKey: 'edit.groupBattle' },
  { id: 'battle:partyHp1', labelKey: 'edit.actPartyHp1Long', descKey: 'edit.actPartyHp1Desc', groupKey: 'edit.groupBattle' },
  { id: 'battle:partyHp0', labelKey: 'edit.actPartyHp0Long', descKey: 'edit.actPartyHp0Desc', groupKey: 'edit.groupBattle' },
]

export function hotkeyIdForFlag(key: RunFlagKey) {
  return `flag:${key}`
}

export function hotkeyIdForAction(id: RunActionId) {
  return `action:${id}`
}

export const OPEN_PANEL_HOTKEY_TARGET: HotkeyTarget = {
  id: OPEN_PANEL_HOTKEY_ID,
  kind: 'ui',
  target: 'toggle',
  labelKey: 'edit.hkOpenPanel',
  descKey: 'edit.hkOpenPanelDesc',
  groupKey: 'edit.groupPanel',
}

export const OPEN_CONSOLE_HOTKEY_TARGET: HotkeyTarget = {
  id: OPEN_CONSOLE_HOTKEY_ID,
  kind: 'ui',
  target: 'console',
  labelKey: 'edit.hkOpenConsole',
  descKey: 'edit.hkOpenConsoleDesc',
  groupKey: 'edit.groupPanel',
}

const TOOL_PANEL_HOTKEY_ITEMS: ReadonlyArray<{ panel: ToolPanelId; labelKey: MessageKey; descKey: MessageKey }> = [
  { panel: 'miniMap', labelKey: 'edit.hkPanelMiniMap', descKey: 'edit.hkPanelMiniMapDesc' },
  { panel: 'companion', labelKey: 'edit.hkPanelCompanion', descKey: 'edit.hkPanelCompanionDesc' },
  { panel: 'autoSaves', labelKey: 'edit.hkPanelAutoSaves', descKey: 'edit.hkPanelAutoSavesDesc' },
  { panel: 'quickSaves', labelKey: 'edit.hkPanelQuickSaves', descKey: 'edit.hkPanelQuickSavesDesc' },
  { panel: 'panelDock', labelKey: 'edit.hkPanelDock', descKey: 'edit.hkPanelDockDesc' },
]

const TOOL_PANEL_TARGET_PREFIX = 'panel:'

/** 迷你面板开关键：`ui:panel:<ToolPanelId>`，默认不绑定 */
export function toolPanelHotkeyId(panel: ToolPanelId): string {
  return `ui:${TOOL_PANEL_TARGET_PREFIX}${panel}`
}

/** `ui` 类目标中的迷你面板 id；唤出键、控制台返回 null */
export function toolPanelFromHotkeyTarget(target: string): string | null {
  return target.startsWith(TOOL_PANEL_TARGET_PREFIX) ? target.slice(TOOL_PANEL_TARGET_PREFIX.length) : null
}

/** 快捷键页全部可绑定项（面板 + 迷你面板 + 开关 + 触发） */
export const RUN_HOTKEY_TARGETS: readonly HotkeyTarget[] = [
  OPEN_PANEL_HOTKEY_TARGET,
  OPEN_CONSOLE_HOTKEY_TARGET,
  ...TOOL_PANEL_HOTKEY_ITEMS.map((row) => ({
    id: toolPanelHotkeyId(row.panel),
    kind: 'ui' as const,
    target: `${TOOL_PANEL_TARGET_PREFIX}${row.panel}`,
    labelKey: row.labelKey,
    descKey: row.descKey,
    groupKey: 'edit.groupMiniPanels' as const,
  })),
  ...RUN_FLAG_HOTKEY_ROWS.map((row) => ({
    id: hotkeyIdForFlag(row.key),
    kind: 'flag' as const,
    target: row.key,
    labelKey: row.labelKey,
    descKey: row.descKey,
    groupKey: 'edit.groupFlags' as const,
  })),
  ...ACTION_HOTKEY_ITEMS.map((row) => ({
    id: hotkeyIdForAction(row.id),
    kind: 'action' as const,
    target: row.id,
    labelKey: row.labelKey,
    descKey: row.descKey,
    groupKey: row.groupKey,
  })),
  ...(['save', 'load'] as const).flatMap((action) =>
    Array.from({ length: QUICK_SAVE_SLOTS }, (_, slot) => ({
      id: quickSaveHotkeyId(action, slot),
      kind: 'save' as const,
      target: quickSaveHotkeyId(action, slot),
      labelKey: action === 'save' ? ('edit.hkQuickSave' as const) : ('edit.hkQuickLoad' as const),
      labelParams: { slot },
      descKey: action === 'save' ? ('edit.hkQuickSaveDesc' as const) : ('edit.hkQuickLoadDesc' as const),
      groupKey: 'edit.groupQuickSave' as const,
    }))
  ),
]

export function emptyHotkeys(): HotkeyMap {
  return {}
}

/** 稀疏本游戏覆盖（可无唤出键 = 继承全局） */
export function emptyGameHotkeys(): HotkeyMap {
  return {}
}

const LEGACY_STORAGE_KEY = 'chaya.gameEdit.hotkeys'
const GLOBAL_STORAGE_KEY = 'chaya.gameEdit.hotkeys.global'
const GAME_STORAGE_KEY = 'chaya.gameEdit.hotkeys.game'

/** 局内运行时本游戏覆盖缓存（供唤出键在 React 外读取） */
let gameHotkeysCache: HotkeyMap = {}

export function setGameHotkeysCache(map: HotkeyMap | null | undefined) {
  gameHotkeysCache = map && typeof map === 'object' ? { ...map } : {}
}

export function getGameHotkeysCache(): HotkeyMap {
  return gameHotkeysCache
}

function parseHotkeyMapRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 全局表：只保留非空绑定；面板/控制台未设时运行时再回落系统默认 */
function normalizeGlobalHotkeyMap(raw: Record<string, unknown>): HotkeyMap {
  const out: HotkeyMap = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  if (isApplePlatform() && out[OPEN_CONSOLE_HOTKEY_ID]?.toLowerCase() === LEGACY_MAC_OPEN_CONSOLE_CHORD.toLowerCase()) {
    delete out[OPEN_CONSOLE_HOTKEY_ID]
  }
  return out
}

/** 本游戏覆盖：稀疏，不强制唤出键 */
export function normalizeGameHotkeyMap(raw: Record<string, unknown>): HotkeyMap {
  const out: HotkeyMap = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

export function loadGlobalHotkeys(): HotkeyMap {
  if (typeof window === 'undefined') return emptyHotkeys()
  try {
    let raw = window.localStorage.getItem(GLOBAL_STORAGE_KEY)
    if (!raw) {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) {
        raw = legacy
        try {
          window.localStorage.setItem(GLOBAL_STORAGE_KEY, legacy)
        } catch {
          /* */
        }
      }
    }
    const parsed = parseHotkeyMapRaw(raw)
    if (!parsed) return emptyHotkeys()
    return normalizeGlobalHotkeyMap(parsed)
  } catch {
    return emptyHotkeys()
  }
}

export function saveGlobalHotkeys(map: HotkeyMap) {
  if (typeof window === 'undefined') return
  try {
    const normalized = normalizeGlobalHotkeyMap(map as unknown as Record<string, unknown>)
    window.localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* ignore quota */
  }
}

/** Web 侧本游戏覆盖（单槽；局内以游戏盘为准） */
export function loadGameStoredHotkeys(): HotkeyMap {
  if (typeof window === 'undefined') return emptyGameHotkeys()
  try {
    const parsed = parseHotkeyMapRaw(window.localStorage.getItem(GAME_STORAGE_KEY))
    if (!parsed) return emptyGameHotkeys()
    return normalizeGameHotkeyMap(parsed)
  } catch {
    return emptyGameHotkeys()
  }
}

export function saveGameStoredHotkeys(map: HotkeyMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(normalizeGameHotkeyMap(map as unknown as Record<string, unknown>)))
  } catch {
    /* ignore quota */
  }
}

const DISABLED_STORAGE_KEY = 'chaya.gameEdit.hotkeys.disabled'

let disabledHotkeysCache: ReadonlySet<string> | null = null

/** 唤出键不可暂停：局内暂停后无法再打开面板恢复 */
export function canDisableHotkey(id: string): boolean {
  return id !== OPEN_PANEL_HOTKEY_ID
}

/** 临时暂停的快捷键 id（保留绑定，仅不触发） */
export function loadDisabledHotkeys(): ReadonlySet<string> {
  if (disabledHotkeysCache) return disabledHotkeysCache
  if (typeof window === 'undefined') return new Set()
  let ids: string[] = []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISABLED_STORAGE_KEY) || '[]') as unknown
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string' && canDisableHotkey(v))
  } catch {
    /* */
  }
  disabledHotkeysCache = new Set(ids)
  return disabledHotkeysCache
}

export function saveDisabledHotkeys(ids: Iterable<string>) {
  const next = new Set([...ids].filter(canDisableHotkey))
  disabledHotkeysCache = next
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISABLED_STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    /* ignore quota */
  }
}

export function isHotkeyDisabled(id: string): boolean {
  return loadDisabledHotkeys().has(id)
}

/** @deprecated 用 loadGlobalHotkeys；保留别名兼容旧调用 */
export function loadStoredHotkeys(): HotkeyMap {
  return loadGlobalHotkeys()
}

/** @deprecated 用 saveGlobalHotkeys */
export function saveStoredHotkeys(map: HotkeyMap) {
  saveGlobalHotkeys(map)
}

/** 局内读取当前唤出键：本游戏 → 全局 → ` */
export function getOpenPanelChord(): string {
  return resolveHotkeyChord(OPEN_PANEL_HOTKEY_ID, gameHotkeysCache, loadGlobalHotkeys())
}

/** 局内读取当前控制台键：本游戏 → 全局 → Chrome 系统默认 */
export function getOpenConsoleChord(): string {
  return resolveHotkeyChord(OPEN_CONSOLE_HOTKEY_ID, gameHotkeysCache, loadGlobalHotkeys())
}

/** 从 KeyboardEvent 生成绑定串；纯修饰键返回 null */
export function formatKeyChord(ev: KeyboardEvent): string | null {
  return chordFromEvent(ev, true)
}

/** `byCode = false` 是改按物理键位之前的格式，用于匹配已保存的旧绑定 */
function chordFromEvent(ev: KeyboardEvent, byCode: boolean): string | null {
  if (ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Shift' || ev.key === 'Meta') return null
  if (ev.key === 'Escape' || ev.key === 'Tab') return null
  const parts: string[] = []
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl')
  if (ev.altKey) parts.push('Alt')
  if (ev.shiftKey) parts.push('Shift')
  let key = ev.key
  // 主键盘数字按物理键位（macOS ⌥3 的 key 是「£」、Shift+3 是「#」）；字母只在 Alt 时按键位，其余跟随键盘布局
  const digit = byCode ? /^Digit([0-9])$/.exec(ev.code || '') : null
  const letter = byCode && ev.altKey ? /^Key([A-Z])$/.exec(ev.code || '') : null
  if (digit || letter) key = (digit ?? letter)![1]
  else if (key === ' ') key = 'Space'
  else if (ev.code === 'Backquote' && (key === 'Dead' || key === '`')) key = DEFAULT_OPEN_PANEL_CHORD
  else if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

export function matchKeyChord(ev: KeyboardEvent, chord: string): boolean {
  if (!chord) return false
  const wanted = chord.toLowerCase()
  return [chordFromEvent(ev, true), chordFromEvent(ev, false)].some((formatted) => formatted?.toLowerCase() === wanted)
}

/**
 * 匹配唤出作弊器热键。
 * 默认 ` 时额外用 Backquote code 兜底（部分布局 key 不稳定）。
 */
export function matchOpenPanelHotkey(ev: KeyboardEvent, chord = getOpenPanelChord()): boolean {
  if (matchKeyChord(ev, chord)) return true
  if (chord === DEFAULT_OPEN_PANEL_CHORD && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.code === 'Backquote') {
    return true
  }
  return false
}

export function parseHotkeyId(id: string): { kind: HotkeyKind; target: string } | null {
  if (id.startsWith('flag:')) return { kind: 'flag', target: id.slice(5) }
  if (id.startsWith('action:')) return { kind: 'action', target: id.slice(7) }
  if (id.startsWith('ui:')) return { kind: 'ui', target: id.slice(3) }
  if (parseQuickSaveHotkeyId(id)) return { kind: 'save', target: id }
  return null
}
