/**
 * In-game: read catalogs / session from RPG Maker runtime; write gold and item counts.
 */
import { type ActorDraft, countKey, GOLD_LOCK_KEY, type ItemKind, lockKeyForActorVital, lockKeyForSwitch, lockKeyForVar, type SessionState } from '@/components/game-edit/types'
import type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'

import { itemLabel, tName } from '../console/item-label'
import { Cheats } from '../runtime/cheats'
import { RunCheats } from '../runtime/cheats-run'

/** 局内面板只读当前页。`items` / `events` / `full` 仍扫三类持有数；单页用 `item` / `weapon` / `armor`。 */
export type LiveSessionScope = 'run' | 'item' | 'weapon' | 'armor' | 'items' | 'vars' | 'switches' | 'actors' | 'events' | 'full'

export type CatalogSlice = 'items' | 'weapons' | 'armors' | 'variables' | 'switches' | 'actors' | 'skills' | 'states' | 'classes'

function catalogFromDb(db: Array<{ id?: number; name?: string; description?: string } | null> | undefined): CatalogEntry[] {
  if (!db) return []
  const out: CatalogEntry[] = []
  for (let i = 1; i < db.length; i++) {
    const row = db[i]
    if (!row) continue
    const info = itemLabel(row)
    out.push({
      id: i,
      name: info.zh || info.name,
      description: info.zh && info.zh !== info.name ? info.name : row.description,
    })
  }
  return out
}

function namesFromSystem(list: unknown): CatalogEntry[] {
  const arr = list as Array<string | null | undefined> | undefined
  if (!arr) return []
  const out: CatalogEntry[] = []
  for (let i = 1; i < arr.length; i++) {
    const n = arr[i]
    if (n == null) continue
    out.push({ id: i, name: tName(String(n)) || String(n) })
  }
  return out
}

function emptyLiveCatalog(): GameEditCatalog {
  return {
    ok: true,
    contentRoot: '',
    source: 'disk',
    items: [],
    weapons: [],
    armors: [],
    variables: [],
    switches: [],
    actors: [],
    skills: [],
    states: [],
    classes: [],
  }
}

/** 只建当前页要的目录块，其余沿用已有结果。 */
export function buildLiveCatalogSlices(slices: readonly CatalogSlice[], prev?: GameEditCatalog | null): GameEditCatalog {
  const next = prev ? { ...prev } : emptyLiveCatalog()
  for (const slice of slices) {
    if (slice === 'items') next.items = catalogFromDb($dataItems)
    else if (slice === 'weapons') next.weapons = catalogFromDb($dataWeapons)
    else if (slice === 'armors') next.armors = catalogFromDb($dataArmors)
    else if (slice === 'variables') next.variables = namesFromSystem($dataSystem?.variables)
    else if (slice === 'switches') next.switches = namesFromSystem($dataSystem?.switches)
    else if (slice === 'actors') next.actors = catalogFromDb($dataActors)
    else if (slice === 'skills') next.skills = catalogFromDb($dataSkills)
    else if (slice === 'states') next.states = catalogFromDb($dataStates)
    else next.classes = catalogFromDb($dataClasses)
  }
  return next
}

export function buildLiveCatalog(): GameEditCatalog {
  return buildLiveCatalogSlices(['items', 'weapons', 'armors', 'variables', 'switches', 'actors', 'skills', 'states', 'classes'])
}

function syncLocksIntoSession(prev: SessionState): Record<string, number> {
  const locks: Record<string, number> = { ...prev.locks }
  if (!$gameParty) return locks
  if (Cheats.isLocked('gold')) locks[GOLD_LOCK_KEY] = $gameParty.gold()
  else delete locks[GOLD_LOCK_KEY]
  return locks
}

function readRunFields(
  prev: SessionState
): Pick<
  SessionState,
  | 'gold'
  | 'walkRate'
  | 'runRate'
  | 'gameSpeed'
  | 'fullscreen'
  | 'alwaysDash'
  | 'god'
  | 'autoWin'
  | 'autoBattle'
  | 'through'
  | 'autotalk'
  | 'encounter'
  | 'menuEnabled'
  | 'saveEnabled'
  | 'clickMove'
  | 'followers'
  | 'clickTeleport'
  | 'resourceSkip'
  | 'expRate'
> {
  const boost = (window as Window & { ChayaBoost?: { status?: () => { walk: number; run: number; gameSpeed?: number } } }).ChayaBoost
  const st = boost?.status?.()
  RunCheats.ensureHooks()
  return {
    gold: $gameParty ? $gameParty.gold() : prev.gold,
    walkRate: st?.walk ?? prev.walkRate,
    runRate: st?.run ?? prev.runRate,
    gameSpeed: st?.gameSpeed ?? prev.gameSpeed,
    fullscreen: RunCheats.getFullscreen(),
    alwaysDash: typeof ConfigManager !== 'undefined' ? !!ConfigManager.alwaysDash : prev.alwaysDash,
    god: Cheats.getGod(),
    autoWin: Cheats.getAutoWin(),
    autoBattle: Cheats.getAutoBattle(),
    through: Cheats.getThrough(),
    autotalk: typeof window.ChayaEdit?.autoTalk === 'function' ? !!window.ChayaEdit.autoTalk() : prev.autotalk,
    encounter: RunCheats.getEncounter(),
    menuEnabled: RunCheats.getMenuEnabled(),
    saveEnabled: RunCheats.getSaveEnabled(),
    clickMove: RunCheats.getClickMove(),
    followers: RunCheats.getFollowersVisible(),
    clickTeleport: RunCheats.getClickTeleport(),
    resourceSkip: RunCheats.getResourceSkip(),
    expRate: RunCheats.getExpRate(),
  }
}

function readItemCounts(prev: SessionState, kinds: readonly ItemKind[]): { counts: Record<string, number>; locks: Record<string, number> } {
  const counts: Record<string, number> = { ...prev.counts }
  const locks = syncLocksIntoSession(prev)
  const push = (kind: ItemKind, db: typeof $dataItems) => {
    if (!db || !$gameParty) return
    for (let i = 1; i < db.length; i++) {
      const item = db[i]
      if (!item) continue
      const key = countKey(kind, i)
      counts[key] = $gameParty.numItems(item)
      if (Cheats.isLocked(kind, i)) locks[key] = counts[key] ?? 0
      else delete locks[key]
    }
  }
  if (kinds.includes('item')) push('item', $dataItems)
  if (kinds.includes('weapon')) push('weapon', $dataWeapons)
  if (kinds.includes('armor')) push('armor', $dataArmors)
  return { counts, locks }
}

function itemKindsForScope(scope: LiveSessionScope): ItemKind[] | null {
  if (scope === 'item') return ['item']
  if (scope === 'weapon') return ['weapon']
  if (scope === 'armor') return ['armor']
  if (scope === 'items' || scope === 'events' || scope === 'full') return ['item', 'weapon', 'armor']
  return null
}

function readVars(prev: SessionState, locksIn: Record<string, number>): { vars: Record<number, number>; locks: Record<string, number> } {
  const vars: Record<number, number> = { ...prev.vars }
  const locks = { ...locksIn }
  if ($gameVariables && $dataSystem?.variables) {
    for (let i = 1; i < $dataSystem.variables.length; i++) {
      vars[i] = Number($gameVariables.value(i)) || 0
      const key = lockKeyForVar(i)
      if (Cheats.isLocked('var', i)) locks[key] = vars[i] ?? 0
      else delete locks[key]
    }
  }
  return { vars, locks }
}

function readSwitches(prev: SessionState, locksIn: Record<string, number>): { switches: Record<number, boolean>; locks: Record<string, number> } {
  const switches: Record<number, boolean> = { ...prev.switches }
  const locks = { ...locksIn }
  if ($gameSwitches && $dataSystem?.switches) {
    for (let i = 1; i < $dataSystem.switches.length; i++) {
      switches[i] = !!$gameSwitches.value(i)
      const key = lockKeyForSwitch(i)
      if (Cheats.isLocked('sw', i)) locks[key] = switches[i] ? 1 : 0
      else delete locks[key]
    }
  }
  return { switches, locks }
}

function readActors(prev: SessionState, locksIn: Record<string, number>): { actors: Record<number, ActorDraft>; locks: Record<string, number> } {
  const actors: Record<number, ActorDraft> = { ...prev.actors }
  const locks = { ...locksIn }
  if (!$dataActors) return { actors, locks }
  for (let i = 1; i < $dataActors.length; i++) {
    if (!$dataActors[i]) continue
    const info = window.ChayaEdit?.actor?.(i)?.info?.() as
      | {
          name?: string
          nickname?: string
          profile?: string
          level?: number
          exp?: number
          hp?: string
          mp?: string
          classId?: number
          skills?: number[]
          states?: number[]
          mhp?: number
          mmp?: number
          atk?: number
          def?: number
          mat?: number
          mdf?: number
          agi?: number
          luk?: number
        }
      | null
      | undefined
    if (!info) continue
    const [hpCur, hpMax] = String(info.hp || '0/0')
      .split('/')
      .map((x) => Number(x) || 0)
    const [mpCur, mpMax] = String(info.mp || '0/0')
      .split('/')
      .map((x) => Number(x) || 0)
    actors[i] = {
      name: String(info.name || $dataActors[i]?.name || `角色 #${i}`),
      nickname: String(info.nickname || ''),
      profile: String(info.profile || ''),
      level: Number(info.level) || 1,
      exp: Number(info.exp) || 0,
      hp: hpCur,
      mp: mpCur,
      mhp: Number(info.mhp) || hpMax || 1,
      mmp: Number(info.mmp) || mpMax || 0,
      atk: Number(info.atk) || 0,
      def: Number(info.def) || 0,
      mat: Number(info.mat) || 0,
      mdf: Number(info.mdf) || 0,
      agi: Number(info.agi) || 0,
      luk: Number(info.luk) || 0,
      classId: Number(info.classId) || 1,
      skillIds: Array.isArray(info.skills) ? info.skills.map(Number).filter((n) => n > 0) : [],
      stateIds: Array.isArray(info.states) ? info.states.map(Number).filter((n) => n > 0) : [],
    }
    for (const kind of ['level', 'exp', 'hp', 'mp', 'mhp', 'mmp', 'tp'] as const) {
      const key = lockKeyForActorVital(kind, i)
      if (Cheats.isLocked(kind, i)) locks[key] = Cheats.lockValue(kind, i) ?? 0
      else delete locks[key]
    }
  }
  return { actors, locks }
}

/**
 * 读局内会话。默认 `full`（远程桥）。局内面板只传当前页的 scope，地图/公共事件用 `events`（条件要用的开关、变量、持有数）。
 */
/** 敌方锁只在本场战斗有效，不进磁盘；每次读取按 Cheats 里还在的锁重写。 */
function syncEnemyLocks(locks: Record<string, number>): Record<string, number> {
  const next = { ...locks }
  for (const key of Object.keys(next)) {
    if (key.startsWith('enemyHp:') || key.startsWith('enemyMhp:')) delete next[key]
  }
  for (const entry of Cheats.listLocks()) {
    if (entry.kind === 'enemyHp' || entry.kind === 'enemyMhp') next[`${entry.kind}:${entry.id}`] = entry.value
  }
  return next
}

export function readLiveSession(prev: SessionState, scope: LiveSessionScope = 'full'): SessionState {
  if (!$gameParty) return prev
  const run = readRunFields(prev)
  if (scope === 'run') {
    return { ...prev, ...run, locks: syncEnemyLocks(syncLocksIntoSession(prev)) }
  }

  let locks = syncLocksIntoSession(prev)
  let counts = prev.counts
  let vars = prev.vars
  let switches = prev.switches
  let actors = prev.actors

  const kinds = itemKindsForScope(scope)
  const wantVars = scope === 'vars' || scope === 'events' || scope === 'full'
  const wantSw = scope === 'switches' || scope === 'events' || scope === 'full'
  const wantActors = scope === 'actors' || scope === 'full'

  if (kinds) {
    const next = readItemCounts({ ...prev, locks }, kinds)
    counts = next.counts
    locks = next.locks
  }
  if (wantVars) {
    const next = readVars(prev, locks)
    vars = next.vars
    locks = next.locks
  }
  if (wantSw) {
    const next = readSwitches(prev, locks)
    switches = next.switches
    locks = next.locks
  }
  if (wantActors) {
    const next = readActors(prev, locks)
    actors = next.actors
    locks = next.locks
  }

  return {
    ...prev,
    ...run,
    counts,
    vars,
    switches,
    locks: syncEnemyLocks(locks),
    actors,
  }
}

export function setPartyGold(n: number) {
  if (!$gameParty) return
  const delta = Math.max(0, Math.floor(n)) - $gameParty.gold()
  if (delta >= 0) $gameParty.gainGold(delta)
  else $gameParty.loseGold(-delta)
}

export function setItemCount(kind: ItemKind, id: number, count: number) {
  const db = kind === 'weapon' ? $dataWeapons : kind === 'armor' ? $dataArmors : $dataItems
  const item = db?.[id]
  if (!item || !$gameParty) return
  const cur = $gameParty.numItems(item)
  const n = Math.max(0, Math.floor(count))
  if (cur !== n) $gameParty.gainItem(item, n - cur, true)
}
