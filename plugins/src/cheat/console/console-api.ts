/**
 * `window.ChayaEdit` / `window.ge` console API.
 */
import { createLogger, showPluginError } from '../../helpers'
import { getAutoTalk, setAutoTalk } from '../runtime/auto-talk'
import { Cheats, type LockKind } from '../runtime/cheats'
import { agentEdit } from '../session/agent-edit'
import { buildLiveCatalog } from '../session/live-session'
import { hideGameEditUi, isGameEditUiOpen, showGameEditUi, toggleGameEditUi } from '../ui/mount'
import { actorApi } from './actor-api'
import { findInDb, needParty, setItemLike } from './party-items'

const log = createLogger('ChayaEdit')

function getBoostApi(): {
  walkRate: (n?: number) => unknown
  runRate: (n?: number) => unknown
  rates: (o?: { walk?: number; run?: number }) => { walk: number; run: number; alwaysDash?: boolean }
  dash: (on?: boolean) => unknown
  status: () => { walk: number; run: number; alwaysDash?: boolean }
} | null {
  const b = (window as Window & { ChayaBoost?: { rates?: unknown } }).ChayaBoost as ReturnType<typeof getBoostApi>
  if (!b || typeof b.rates !== 'function') return null
  return b
}

export function installConsoleApi() {
  window.ChayaEdit = {
    ui: () => {
      if (!$gameParty) {
        log.warn('请先读档进游戏再开面板')
        showPluginError('无法打开插件控制台', '请先读档进入游戏地图后再试')
        return false
      }
      try {
        return showGameEditUi()
      } catch (err) {
        log.fail('ui 失败', err)
        showPluginError('无法打开插件控制台', err)
        return false
      }
    },
    hide: hideGameEditUi,
    toggle: () => {
      if (!$gameParty && !isGameEditUiOpen()) {
        log.warn('请先读档进游戏再开面板')
        showPluginError('无法打开插件控制台', '请先读档进入游戏地图后再试')
        return false
      }
      try {
        return toggleGameEditUi()
      } catch (err) {
        log.fail('toggle 失败', err)
        showPluginError('无法打开插件控制台', err)
        try {
          hideGameEditUi()
        } catch {
          /* */
        }
        return false
      }
    },

    gold(n?: number) {
      if (!needParty()) return null
      if (n != null) {
        const delta = Number(n) - $gameParty.gold()
        if (delta >= 0) $gameParty.gainGold(delta)
        else $gameParty.loseGold(-delta)
      }
      const v = $gameParty.gold()
      log.ok('gold = ' + v)
      return v
    },

    item(id: number, count?: number) {
      const info = setItemLike($dataItems, id, count == null ? 99 : count)
      if (info) log.ok('已设置', info)
      return info
    },
    weapon(id: number, count?: number) {
      const info = setItemLike($dataWeapons, id, count == null ? 1 : count)
      if (info) log.ok('已设置', info)
      return info
    },
    armor(id: number, count?: number) {
      const info = setItemLike($dataArmors, id, count == null ? 1 : count)
      if (info) log.ok('已设置', info)
      return info
    },

    itemName(keyword: string, count?: number) {
      const hits = findInDb($dataItems, keyword, 5)
      if (!hits.length) {
        log.warn('未找到物品', keyword)
        return null
      }
      if (hits.length > 1) {
        console.table(hits)
        return hits
      }
      return window.ChayaEdit.item(hits[0].id, count == null ? 99 : count)
    },

    var(id: number, value?: number) {
      if (!$gameVariables) return null
      if (arguments.length >= 2) $gameVariables.setValue(id, value)
      return $gameVariables.value(id)
    },
    sw(id: number, value?: boolean) {
      if (!$gameSwitches) return null
      if (arguments.length >= 2) $gameSwitches.setValue(id, !!value)
      return $gameSwitches.value(id)
    },
    actor(id?: number) {
      return actorApi(id == null ? 1 : id)
    },
    /** Database names / ids for the edit panel and the in-game MCP `chaya_edit_catalog` */
    catalog() {
      return buildLiveCatalog()
    },
    /** Edit-page commands for ChayaAgent (`edit.state` / `edit.apply` / `edit.action`) */
    agentEdit,
    autoTalk(on?: boolean) {
      if (arguments.length === 0) return getAutoTalk()
      const v = setAutoTalk(!!on)
      log.ok('autoTalk = ' + v)
      return v
    },
    speed(walkOrOpts?: number | { walk?: number; run?: number; dash?: boolean }, run?: number) {
      const boost = getBoostApi()
      if (typeof walkOrOpts === 'object' && walkOrOpts) {
        if (boost) {
          if (walkOrOpts.walk != null || walkOrOpts.run != null) {
            boost.rates({ walk: walkOrOpts.walk, run: walkOrOpts.run })
          }
          if (walkOrOpts.dash != null) boost.dash(!!walkOrOpts.dash)
        }
      } else if (walkOrOpts != null || run != null) {
        const cur = boost ? boost.status() : { walk: 1, run: 1 }
        const w = walkOrOpts != null ? Number(walkOrOpts) : cur.walk
        const r = run != null ? Number(run) : cur.run
        if (boost) boost.rates({ walk: w, run: r })
      }
      const st = boost ? boost.status() : null
      log.ok('speed', st)
      return st
    },

    god(on?: boolean) {
      if (arguments.length === 0) return Cheats.getGod()
      const v = Cheats.setGod(!!on)
      log.ok('god = ' + v)
      return v
    },
    through(on?: boolean) {
      if (arguments.length === 0) return Cheats.getThrough()
      const v = Cheats.setThrough(!!on)
      log.ok('through = ' + v)
      return v
    },
    lock(kind: LockKind, id: number, on = true, value?: number) {
      const v = Cheats.setLock(kind, id, !!on, value)
      log.ok(`lock ${kind}:${id} = ${v}`)
      return v
    },
    teleport(mapId: number, x: number, y: number, d?: number) {
      const ok = Cheats.teleport(mapId, x, y, d)
      if (ok) log.ok(`teleport ${mapId} (${x},${y})`)
      return ok
    },
    commonEvent(id: number) {
      const ok = Cheats.runCommonEvent(id)
      if (ok) log.ok('commonEvent #' + id)
      return ok
    },
    mapEvent(id: number) {
      const ok = Cheats.startMapEvent(id)
      if (ok) log.ok('mapEvent #' + id)
      return ok
    },
    save(n = 1) {
      const ok = Cheats.saveGame(n)
      log.ok('save #' + n + ' = ' + ok)
      return ok
    },
    load(n = 1) {
      const ok = Cheats.loadGame(n)
      log.ok('load #' + n + ' = ' + ok)
      return ok
    },
    troop(id: number) {
      const ok = Cheats.startTroop(id)
      if (ok) log.ok('troop #' + id)
      return ok
    },
    skipEvent() {
      return Cheats.skipInterpreter()
    },
    clearEvent() {
      return Cheats.clearInterpreter()
    },

    findItem(keyword: string) {
      const hits = findInDb($dataItems, keyword)
      console.table(hits)
      return hits
    },
    findWeapon(keyword: string) {
      const hits = findInDb($dataWeapons, keyword)
      console.table(hits)
      return hits
    },
    findArmor(keyword: string) {
      const hits = findInDb($dataArmors, keyword)
      console.table(hits)
      return hits
    },
    findVar(keyword: string) {
      log.info('findVar', keyword)
      return showGameEditUi()
    },
    findSw(keyword: string) {
      log.info('findSw', keyword)
      return showGameEditUi()
    },
    bag() {
      return showGameEditUi()
    },

    help() {
      console.log(`
ChayaEdit（React 面板，与控制台共用组件）：
  按唤出键（默认 \`，可在快捷键页改）或 ChayaEdit.ui() / ge.ui()
  ChayaEdit.gold(999999)
  ChayaEdit.item(12, 99) / itemName('关键词', 10)
  ChayaEdit.var(id, v) / sw(id, true)
  ChayaEdit.actor(1).level(99).hp().mp()
  ChayaEdit.autoTalk(true) / speed(2, 4) / god(true) / through(true)
  ChayaEdit.lock('item', 12, true) / teleport / commonEvent / save / load
`)
    },
  }

  window.ge = window.ChayaEdit
}
