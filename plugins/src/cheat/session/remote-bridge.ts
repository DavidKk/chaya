/**
 * In-game: receive Web edit.cmd and apply; after subscribe, push edit.state.
 */
import { emptySession, lockKeyForActorSkill, lockKeyForActorState, type SessionState } from '@/components/game-edit/types'
import { fieldsForEditCmd } from '@/lib/runtime/game-edit-sync'
import type { GameEditCmd, GameEditStateMsg, GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { sendChunked } from '@/lib/runtime/link-chunks'

import { applyGameSpeed, applyRunAction, applyRunFlag, applySpeed } from '../runtime/apply-run'
import { Cheats } from '../runtime/cheats'
import { RunCheats } from '../runtime/cheats-run'
import { addEnemy, killEnemy, readBattleState, recoverEnemy, reviveEnemy, transformEnemy, writeEnemyHp, writeEnemyMhp } from './live-battle'
import { buildLiveCommonEventsData, isOnMapScene, runCommonEventOnMap } from './live-events'
import { buildLiveMapDetail, playerSpot, runMapEvent, runningCommonEvents, setSelfSwitch, teleportPlayer } from './live-map'
import { joinActor, recoverActor, reviveActor, writeActorVital } from './live-party'
import { buildLiveCatalog, readLiveSession, setItemCount, setPartyGold } from './live-session'
import { startTroopBattle } from './live-troop'
import { recentMaps } from './map-history'
import { handleDataMessage, isDataCmd, runDataCmd, sendSized, stopDataBridge } from './save-data-bridge'

type SendFn = (msg: GameLinkMessage) => void

let subscribed = false
let pushTimer: ReturnType<typeof setInterval> | null = null
let sendFn: SendFn | null = null
/** Local overlay mirror; merge with live before push */
let mirror: SessionState = emptySession()
/** Successfully acked cmdIds (bounded; avoid retry double-effects) */
const ackedCmdIds = new Set<string>()
/** Results of acked data ops, replayed when a retry arrives */
const ackResults = new Map<string, unknown>()
const ACKED_CAP = 200

function rememberAcked(cmdId: string, result?: unknown) {
  ackedCmdIds.add(cmdId)
  if (result !== undefined) ackResults.set(cmdId, result)
  if (ackedCmdIds.size <= ACKED_CAP) return
  const first = ackedCmdIds.values().next().value
  if (first) {
    ackedCmdIds.delete(first)
    ackResults.delete(first)
  }
}

export function applyEditCmd(cmd: GameEditCmd): void {
  Cheats.ensureHooks()
  RunCheats.ensureHooks()
  switch (cmd.op) {
    case 'gold':
      setPartyGold(cmd.value)
      if (Cheats.isLocked('gold')) Cheats.updateLockValue('gold', 0, cmd.value)
      return
    case 'goldLock':
      Cheats.setLock('gold', 0, cmd.on, cmd.value)
      return
    case 'count':
      setItemCount(cmd.kind, cmd.id, cmd.value)
      if (Cheats.isLocked(cmd.kind, cmd.id)) Cheats.updateLockValue(cmd.kind, cmd.id, cmd.value)
      return
    case 'countLock':
      Cheats.setLock(cmd.kind, cmd.id, cmd.on, cmd.value)
      return
    case 'var':
      if ($gameVariables) $gameVariables.setValue(cmd.id, Math.floor(cmd.value))
      if (Cheats.isLocked('var', cmd.id)) Cheats.updateLockValue('var', cmd.id, cmd.value)
      return
    case 'varLock':
      Cheats.setLock('var', cmd.id, cmd.on, cmd.value)
      return
    case 'sw':
      if ($gameSwitches) $gameSwitches.setValue(cmd.id, cmd.value)
      if (Cheats.isLocked('sw', cmd.id)) Cheats.updateLockValue('sw', cmd.id, cmd.value ? 1 : 0)
      return
    case 'swLock':
      Cheats.setLock('sw', cmd.id, cmd.on, cmd.value)
      return
    case 'runFlag':
      applyRunFlag(cmd.key, cmd.value)
      return
    case 'runAction':
      applyRunAction(cmd.id)
      return
    case 'walkRate':
      applySpeed(cmd.value, mirror.runRate)
      mirror = { ...mirror, walkRate: cmd.value }
      return
    case 'runRate':
      applySpeed(mirror.walkRate, cmd.value)
      mirror = { ...mirror, runRate: cmd.value }
      return
    case 'moveRate':
      applySpeed(cmd.value, cmd.value)
      mirror = { ...mirror, walkRate: cmd.value, runRate: cmd.value }
      return
    case 'gameSpeed':
      applyGameSpeed(cmd.value)
      mirror = { ...mirror, gameSpeed: cmd.value }
      return
    case 'expRate':
      RunCheats.setExpRate(cmd.value)
      return
    case 'actor': {
      const api = window.ChayaEdit?.actor?.(cmd.id)
      const patch = cmd.patch
      if (api) {
        if (patch.name != null) api.name?.(patch.name)
        if (patch.nickname != null) api.nickname?.(patch.nickname)
        if (patch.profile != null) api.profile?.(patch.profile)
        if (patch.level != null) api.level?.(patch.level)
        if (patch.exp != null) api.exp?.(patch.exp)
        if (patch.classId != null) api.classId?.(patch.classId)
        if (patch.hp != null) api.hp?.(patch.hp)
        if (patch.mp != null) api.mp?.(patch.mp)
        if (patch.mhp != null) api.mhp?.(patch.mhp)
        if (patch.mmp != null) api.mmp?.(patch.mmp)
        if (patch.atk != null) api.atk?.(patch.atk)
        if (patch.def != null) api.def?.(patch.def)
        if (patch.mat != null) api.mat?.(patch.mat)
        if (patch.mdf != null) api.mdf?.(patch.mdf)
        if (patch.agi != null) api.agi?.(patch.agi)
        if (patch.luk != null) api.luk?.(patch.luk)
        if (patch.skillIds) api.setSkills?.(patch.skillIds)
        if (patch.stateIds) api.setStates?.(patch.stateIds)
      }
      return
    }
    case 'actorVitalLock':
      Cheats.setLock(cmd.kind, cmd.actorId, cmd.on, cmd.value)
      return
    case 'actorOwnedLock': {
      const key = cmd.kind === 'skills' ? lockKeyForActorSkill(cmd.actorId, cmd.entryId) : lockKeyForActorState(cmd.actorId, cmd.entryId)
      const locks = { ...mirror.locks }
      if (!cmd.on) delete locks[key]
      else locks[key] = cmd.owned ? 1 : 0
      mirror = { ...mirror, locks }
      return
    }
    case 'commonEvent':
      runCommonEventOnMap(cmd.id, cmd.from)
      return
    case 'selfSwitch':
      setSelfSwitch(cmd.mapId, cmd.eventId, cmd.letter, cmd.value)
      return
    case 'teleport':
      // The ack only covers the synchronous checks; landing shows up in the next state push
      void teleportPlayer(cmd).catch(() => undefined)
      return
    case 'mapEvent':
      runMapEvent(cmd)
      return
    case 'troop':
      startTroopBattle(cmd)
      return
    case 'enemyTransform':
      transformEnemy(cmd)
      return
    case 'enemyAdd':
      addEnemy(cmd)
      return
    case 'enemyKill':
      killEnemy(cmd)
      return
    case 'enemyRecover':
      recoverEnemy(cmd)
      return
    case 'enemyRevive':
      reviveEnemy(cmd)
      return
    case 'enemyHp':
      writeEnemyHp(cmd)
      return
    case 'enemyMhp':
      writeEnemyMhp(cmd)
      return
    case 'actorVital':
      writeActorVital(cmd)
      return
    case 'actorRevive':
      reviveActor(cmd)
      return
    case 'actorRecover':
      recoverActor(cmd)
      return
    case 'actorJoin':
      joinActor(cmd)
      return
    default:
      return
  }
}

/** Same session the edit page receives; also read by agents via `ChayaEdit.agentEdit` */
export function buildStateMsg(): GameEditStateMsg {
  if (!$gameParty) {
    const { hotkeys: _h, hotkeysGlobal: _hg, ...rest } = emptySession()
    return { type: 'edit.state', ready: false, session: rest, error: '请先读档进游戏' }
  }
  mirror = readLiveSession(mirror)
  const { hotkeys: _hotkeys, hotkeysGlobal: _hotkeysGlobal, ...session } = mirror
  const spot = playerSpot()
  const battle = readBattleState()
  return {
    type: 'edit.state',
    ready: true,
    session,
    onMap: isOnMapScene(),
    mapId: spot.mapId,
    playerX: spot.x,
    playerY: spot.y,
    playerDir: spot.direction,
    recentMaps: recentMaps(),
    runningCommon: runningCommonEvents(),
    ...(battle ? { battle } : {}),
  }
}

function pushState() {
  if (!subscribed || !sendFn) return
  try {
    sendFn(buildStateMsg())
  } catch {
    /* */
  }
}

export function handleRemoteEditMessage(msg: GameLinkMessage, send: SendFn) {
  sendFn = send
  if (handleDataMessage(msg, send)) return
  if (msg.type === 'edit.catalog.request') {
    send({ type: 'edit.catalog', catalog: buildLiveCatalog() })
    return
  }
  if (msg.type === 'edit.events.request') {
    buildLiveCommonEventsData({ force: msg.force })
      .then((data) => sendChunked(send, { type: 'edit.events', data }))
      .catch((err) => send({ type: 'edit.events', data: { ok: false, error: err instanceof Error ? err.message : '读取公共事件失败' } }))
    return
  }
  if (msg.type === 'edit.map.request') {
    const mapId = msg.mapId
    buildLiveMapDetail(mapId)
      .then((data) => sendChunked(send, { type: 'edit.map', mapId, data }))
      .catch((err) => send({ type: 'edit.map', mapId, data: { ok: false, error: err instanceof Error ? err.message : '读取地图失败' } }))
    return
  }
  if (msg.type === 'edit.subscribe') {
    subscribed = true
    Cheats.ensureHooks()
    RunCheats.ensureHooks()
    if (!pushTimer) pushTimer = setInterval(pushState, 1000)
    pushState()
    try {
      send({ type: 'edit.catalog', catalog: buildLiveCatalog() })
    } catch {
      /* Catalog must not block live state updates. */
    }
    return
  }
  if (msg.type === 'edit.unsubscribe') {
    subscribed = false
    if (pushTimer) {
      clearInterval(pushTimer)
      pushTimer = null
    }
    return
  }
  if (msg.type === 'edit.cmd') {
    const fields = fieldsForEditCmd(msg)
    const already = !!msg.cmdId && ackedCmdIds.has(msg.cmdId)
    try {
      let result: unknown
      if (already) result = ackResults.get(msg.cmdId)
      else {
        if (isDataCmd(msg)) result = runDataCmd(msg)
        else applyEditCmd(msg)
        if (msg.cmdId) rememberAcked(msg.cmdId, result)
      }
      if (msg.cmdId) {
        sendSized(send, { type: 'edit.ack', cmdId: msg.cmdId, fields, ok: true, ...(result !== undefined ? { result } : {}) })
      }
      if (!isDataCmd(msg)) pushState()
    } catch (err) {
      if (msg.cmdId) {
        try {
          send({ type: 'edit.ack', cmdId: msg.cmdId, fields, ok: false, ...(err instanceof Error && err.message ? { error: err.message } : {}) })
        } catch {
          /* */
        }
      }
    }
  }
}

export function stopRemoteEditBridge() {
  subscribed = false
  sendFn = null
  ackedCmdIds.clear()
  ackResults.clear()
  stopDataBridge()
  if (pushTimer) {
    clearInterval(pushTimer)
    pushTimer = null
  }
}

/** After an agent edit: push the new state to a subscribed edit page right away */
export function pushRemoteState() {
  pushState()
}

/** After local panel edits: update mirror and push Web immediately if subscribed */
export function syncRemoteMirror(session: SessionState) {
  mirror = session
  pushState()
}
