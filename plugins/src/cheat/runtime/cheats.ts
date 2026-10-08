/**
 * GameEdit high-value cheats: locks / god mode / through / teleport / common events / map events
 */

import { closeBattleInputWindows } from '../session/battle-windows'
import { RunCheats } from './cheats-run'
import { gameMap, gamePlayer, gameTroop } from './game-globals'

export type LockKind = 'item' | 'weapon' | 'armor' | 'var' | 'gold' | 'hp' | 'mp' | 'sw' | 'level' | 'exp'

type LockEntry = { kind: LockKind; id: number; value: number }

const locks = new Map<string, LockEntry>()
let godMode = false
let throughWalls = false
let autoWin = false
/** 已判胜的战斗场景；胜利结算插件改写 processVictory 后阶段未必变成 battleEnd，按场景实例只判一次，避免重复发奖励 */
let wonScene: unknown = null

/** 战斗开场提示播完、等待指令或回合进行中才判胜；开场 / 已结束时调用会打乱 BattleManager 的阶段 */
const AUTO_WIN_PHASES = new Set(['input', 'turn', 'turnEnd', 'action'])

function tryAutoWin() {
  if (typeof BattleManager === 'undefined' || typeof Scene_Battle !== 'function' || typeof SceneManager === 'undefined') return
  const scene = SceneManager._scene
  if (!(scene instanceof (Scene_Battle as new () => object))) {
    wonScene = null
    return
  }
  if (scene === wonScene || !AUTO_WIN_PHASES.has(String(BattleManager._phase))) return
  // 战斗事件（剧情对话、强制行动）跑完再判胜，免得截断剧情
  if (typeof gameTroop()?.isEventRunning === 'function' && gameTroop().isEventRunning()) return
  wonScene = scene
  Cheats.battleVictory()
}

function lockKey(kind: LockKind, id = 0) {
  return `${kind}:${id}`
}

function dbByKind(kind: 'item' | 'weapon' | 'armor') {
  if (kind === 'weapon') return $dataWeapons
  if (kind === 'armor') return $dataArmors
  return $dataItems
}

function applyItemLock(kind: 'item' | 'weapon' | 'armor', id: number, count: number) {
  const db = dbByKind(kind)
  const item = db && db[id]
  if (!item || !$gameParty) return
  const cur = $gameParty.numItems(item)
  const n = Math.max(0, Math.floor(count))
  if (cur !== n) $gameParty.gainItem(item, n - cur, true)
}

function tickLocks() {
  if (!$gameParty) return
  for (const entry of locks.values()) {
    if (entry.kind === 'gold') {
      const cur = $gameParty.gold()
      const target = Math.max(0, Math.floor(entry.value))
      if (cur !== target) {
        const d = target - cur
        if (d > 0) $gameParty.gainGold(d)
        else $gameParty.loseGold(-d)
      }
    } else if (entry.kind === 'var' && $gameVariables) {
      $gameVariables.setValue(entry.id, entry.value)
    } else if (entry.kind === 'sw' && $gameSwitches) {
      $gameSwitches.setValue(entry.id, entry.value !== 0)
    } else if (entry.kind === 'item' || entry.kind === 'weapon' || entry.kind === 'armor') {
      applyItemLock(entry.kind, entry.id, entry.value)
    } else if (entry.kind === 'hp' || entry.kind === 'mp') {
      const actor = $gameActors && $gameActors.actor(entry.id)
      if (!actor) continue
      if (entry.kind === 'hp') {
        if (actor.hp !== entry.value) actor.setHp(entry.value)
      } else if (actor.mp !== entry.value) {
        actor.setMp(entry.value)
      }
    } else if (entry.kind === 'level') {
      const actor = $gameActors && $gameActors.actor(entry.id)
      if (!actor || typeof actor.changeExp !== 'function') continue
      const target = Math.max(1, Math.floor(entry.value))
      if (actor.level === target) continue
      while (actor.level < target) actor.changeExp(actor.nextLevelExp(), false)
      while (actor.level > target && actor.level > 1) {
        actor.changeExp(Math.max(0, actor.currentLevelExp() - 1), false)
      }
    } else if (entry.kind === 'exp') {
      const actor = $gameActors && $gameActors.actor(entry.id)
      if (!actor || typeof actor.changeExp !== 'function') continue
      const target = Math.max(0, Math.floor(entry.value))
      const cur = typeof actor.currentExp === 'function' ? actor.currentExp() : target
      if (cur !== target) actor.changeExp(target, false)
    }
  }

  if (godMode && $gameParty) {
    for (const m of $gameParty.members()) {
      if (!m) continue
      if (typeof m.isDead === 'function' && m.isDead() && typeof m.revive === 'function') m.revive()
      if (m.hp < m.mhp) m.setHp(m.mhp)
      if (m.mp < m.mmp) m.setMp(m.mmp)
    }
  }

  if (autoWin) tryAutoWin()

  if (throughWalls && gamePlayer() && typeof gamePlayer().setThrough === 'function') {
    if (!gamePlayer().isThrough || !gamePlayer().isThrough()) gamePlayer().setThrough(true)
  }
}

function ensureHooks() {
  const g = globalThis as typeof globalThis & { __chayaCheatsTick?: ReturnType<typeof setInterval> | null }
  if (g.__chayaCheatsTick) return
  RunCheats.ensureHooks()
  g.__chayaCheatsTick = setInterval(() => {
    try {
      if (typeof SceneManager !== 'undefined' && SceneManager._stopped) return
      tickLocks()
    } catch (_) {
      /* */
    }
  }, 200)
}

function disposeCheatsHooks() {
  const g = globalThis as typeof globalThis & { __chayaCheatsTick?: ReturnType<typeof setInterval> | null }
  if (g.__chayaCheatsTick) {
    clearInterval(g.__chayaCheatsTick)
    g.__chayaCheatsTick = null
  }
  locks.clear()
  godMode = false
  throughWalls = false
  autoWin = false
  wonScene = null
  RunCheats.disposeHooks()
}

export const Cheats = {
  ensureHooks,
  disposeHooks: disposeCheatsHooks,

  isLocked(kind: LockKind, id = 0) {
    return locks.has(lockKey(kind, id))
  },

  setLock(kind: LockKind, id: number, on: boolean, value?: number) {
    ensureHooks()
    const key = lockKey(kind, id)
    if (!on) {
      locks.delete(key)
      return false
    }
    let v = value
    if (v == null) {
      if (kind === 'gold') v = $gameParty ? $gameParty.gold() : 0
      else if (kind === 'var') v = $gameVariables ? $gameVariables.value(id) : 0
      else if (kind === 'sw') v = $gameSwitches && $gameSwitches.value(id) ? 1 : 0
      else if (kind === 'hp' || kind === 'mp') {
        const a = $gameActors && $gameActors.actor(id)
        v = a ? (kind === 'hp' ? a.hp : a.mp) : 0
      } else if (kind === 'level') {
        const a = $gameActors && $gameActors.actor(id)
        v = a ? a.level : 1
      } else if (kind === 'exp') {
        const a = $gameActors && $gameActors.actor(id)
        v = a && typeof a.currentExp === 'function' ? a.currentExp() : 0
      } else {
        const item = dbByKind(kind as 'item' | 'weapon' | 'armor')?.[id]
        v = item && $gameParty ? $gameParty.numItems(item) : 0
      }
    }
    locks.set(key, { kind, id, value: Number(v) || 0 })
    return true
  },

  updateLockValue(kind: LockKind, id: number, value: number) {
    const key = lockKey(kind, id)
    const e = locks.get(key)
    if (!e) return
    e.value = Number(value) || 0
  },

  getGod() {
    return godMode
  },
  setGod(on: boolean) {
    ensureHooks()
    godMode = !!on
    if (godMode) tickLocks()
    return godMode
  },

  getAutoWin() {
    return autoWin
  },
  /** 开启后每次进入战斗都立即胜利，直到关闭 */
  setAutoWin(on: boolean) {
    ensureHooks()
    autoWin = !!on
    if (autoWin) tickLocks()
    return autoWin
  },

  getThrough() {
    return throughWalls
  },
  setThrough(on: boolean) {
    ensureHooks()
    throughWalls = !!on
    if (gamePlayer() && typeof gamePlayer().setThrough === 'function') {
      gamePlayer().setThrough(throughWalls)
    }
    return throughWalls
  },

  teleport(mapId: number, x: number, y: number, d = 2) {
    if (!gamePlayer() || typeof gamePlayer().reserveTransfer !== 'function') return false
    const mid = Math.max(1, Math.floor(Number(mapId) || 1))
    const xx = Math.max(0, Math.floor(Number(x) || 0))
    const yy = Math.max(0, Math.floor(Number(y) || 0))
    gamePlayer().reserveTransfer(mid, xx, yy, d, 0)
    return true
  },

  runCommonEvent(id: number) {
    if (!$gameTemp || typeof $gameTemp.reserveCommonEvent !== 'function') return false
    const cid = Math.floor(Number(id) || 0)
    if (cid <= 0) return false
    $gameTemp.reserveCommonEvent(cid)
    return true
  },

  startMapEvent(eventId: number) {
    if (!gameMap() || typeof gameMap().event !== 'function') return false
    const ev = gameMap().event(Math.floor(Number(eventId) || 0))
    if (!ev || typeof ev.start !== 'function') return false
    ev.start()
    return true
  },

  /** Same as Battle Processing (301): the map stays on the scene stack so the battle returns to it */
  startTroop(troopId: number, canEscape = true, canLose = false) {
    const tid = Math.floor(Number(troopId) || 0)
    if (tid <= 0 || !$dataTroops || !$dataTroops[tid]) return false
    if (typeof BattleManager === 'undefined' || typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') return false
    if (typeof Scene_Battle === 'undefined') return false
    BattleManager.setup(tid, !!canEscape, !!canLose)
    BattleManager.setEventCallback?.(null)
    gamePlayer()?.makeEncounterCount?.()
    SceneManager.push(Scene_Battle)
    return true
  },

  saveGame(savefileId: number) {
    if (typeof DataManager === 'undefined' || typeof DataManager.saveGame !== 'function') return false
    const id = Math.max(1, Math.floor(Number(savefileId) || 1))
    return !!DataManager.saveGame(id)
  },

  loadGame(savefileId: number) {
    if (typeof DataManager === 'undefined' || typeof DataManager.loadGame !== 'function') return false
    const id = Math.max(1, Math.floor(Number(savefileId) || 1))
    if (!DataManager.isThisGameFile?.(id) && !DataManager.loadSavefileInfo?.(id)) {
      // Still try load; loadGame returns false when no save exists
    }
    const ok = !!DataManager.loadGame(id)
    if (ok && typeof SceneManager !== 'undefined' && typeof SceneManager.goto === 'function' && typeof Scene_Map !== 'undefined') {
      SceneManager.goto(Scene_Map)
    }
    return ok
  },

  /** Collect interpreters that may be running on the map */
  activeInterpreters() {
    const list: any[] = []
    const push = (it: any) => {
      if (it && typeof it.isRunning === 'function' && it.isRunning() && !list.includes(it)) list.push(it)
    }
    if (gameMap() && gameMap()._interpreter) push(gameMap()._interpreter)
    if (gameTroop() && gameTroop()._interpreter) push(gameTroop()._interpreter)
    if (gameMap() && typeof gameMap().events === 'function') {
      for (const ev of gameMap().events()) {
        if (ev && ev._interpreter) push(ev._interpreter)
      }
    }
    return list
  },

  skipInterpreter() {
    const list = this.activeInterpreters()
    if (!list.length) {
      // Even with none running, still try to advance the map main interpreter
      const it = gameMap() && gameMap()._interpreter
      if (it && typeof it._index === 'number') {
        it._index = (it._index || 0) + 1
        return true
      }
      return false
    }
    for (const it of list) {
      if (typeof it._index === 'number') it._index = (it._index || 0) + 1
    }
    return true
  },

  clearInterpreter() {
    const list = this.activeInterpreters()
    const targets = list.length > 0 ? list : [gameMap() && gameMap()._interpreter, gameTroop() && gameTroop()._interpreter].filter(Boolean)
    let n = 0
    for (const it of targets) {
      if (it && typeof it.clear === 'function') {
        it.clear()
        n++
      }
    }
    if (gameMap() && typeof gameMap().events === 'function') {
      for (const ev of gameMap().events()) {
        if (ev && typeof ev.unlock === 'function') ev.unlock()
      }
    }
    return n > 0
  },

  /** Whether in battle (precondition for force win/lose) */
  inBattle() {
    if ($gameParty && typeof $gameParty.inBattle === 'function' && $gameParty.inBattle()) return true
    if (typeof BattleManager !== 'undefined' && typeof BattleManager.isBattle === 'function' && BattleManager.isBattle()) return true
    return false
  },

  wipeEnemies() {
    if (!this.inBattle() || !gameTroop() || typeof gameTroop().members !== 'function') return false
    let n = 0
    for (const e of gameTroop().members()) {
      if (!e || (typeof e.isHidden === 'function' && e.isHidden())) continue
      if (typeof e.isDead === 'function' && e.isDead()) continue
      if (typeof e.setHp === 'function') {
        e.setHp(0)
        n++
      }
    }
    return n > 0
  },

  healParty() {
    if (!$gameParty || typeof $gameParty.members !== 'function') return false
    let n = 0
    for (const m of $gameParty.members()) {
      if (!m) continue
      if (typeof m.isDead === 'function' && m.isDead() && typeof m.revive === 'function') m.revive()
      if (typeof m.setHp === 'function' && typeof m.mhp === 'number') m.setHp(m.mhp)
      if (typeof m.setMp === 'function' && typeof m.mmp === 'number') m.setMp(m.mmp)
      n++
    }
    return n > 0
  },

  /** Force victory */
  battleVictory() {
    if (!this.inBattle() || typeof BattleManager === 'undefined') return false
    this.wipeEnemies()
    if (typeof BattleManager.processVictory === 'function') {
      closeBattleInputWindows()
      BattleManager.processVictory()
      return true
    }
    return false
  },

  /** Force defeat */
  battleDefeat() {
    if (!this.inBattle() || typeof BattleManager === 'undefined') return false
    if ($gameParty && typeof $gameParty.members === 'function') {
      for (const m of $gameParty.members()) {
        if (m && typeof m.setHp === 'function') m.setHp(0)
      }
    }
    if (typeof BattleManager.processDefeat === 'function') {
      closeBattleInputWindows()
      BattleManager.processDefeat()
      return true
    }
    return false
  },

  /** Abort battle */
  battleAbort() {
    if (!this.inBattle() || typeof BattleManager === 'undefined') return false
    if (typeof BattleManager.processAbort === 'function') {
      BattleManager.processAbort()
      return true
    }
    return false
  },

  /** Force successful escape */
  battleEscape() {
    if (!this.inBattle() || typeof BattleManager === 'undefined') return false
    if (typeof BattleManager.processEscape === 'function') {
      BattleManager.processEscape()
      return true
    }
    return false
  },
}

declare const $dataItems: any[]
declare const $dataWeapons: any[]
declare const $dataArmors: any[]
declare const $dataTroops: any[]
declare const $gameParty: any
declare const $gameVariables: any
declare const $gameActors: any
declare const $gameTemp: any
declare const SceneManager: {
  _stopped?: boolean
  _scene?: unknown
  goto?: (scene: unknown) => void
  push?: (scene: unknown) => void
}
declare const Scene_Battle: unknown
declare const Scene_Map: unknown
declare const BattleManager: {
  setup: (troopId: number, canEscape: boolean, canLose: boolean) => void
  setEventCallback?: (cb: unknown) => void
  isBattle?: () => boolean
  _phase?: string
  processVictory?: () => void
  processDefeat?: () => void
  processAbort?: () => void
  processEscape?: () => void
}
declare const DataManager: {
  saveGame: (id: number) => boolean
  loadGame: (id: number) => boolean
  isThisGameFile?: (id: number) => boolean
  loadSavefileInfo?: (id: number) => unknown
}
