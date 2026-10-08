/**
 * Party side of the current battle: read battle members, edit HP / MP / TP and their caps, revive.
 * Actors are addressed by id, so a reordered party still hits the right one.
 */
import type { ActorVitalKey, BattleActorState } from '@/lib/game/battle'

import { paramCap, writeMaxParam } from './battle-param'
import { assertBattleEditable, settleBattleEnd } from './live-battle'

type Actor = {
  actorId: () => number
  name: () => string
  hp: number
  mhp: number
  mp: number
  mmp: number
  tp?: number
  maxTp?: () => number
  isAlive: () => boolean
  setHp: (hp: number) => void
  setMp: (mp: number) => void
  setTp?: (tp: number) => void
  isDead?: () => boolean
  deathStateId?: () => number
  removeState?: (stateId: number) => void
  performCollapse?: () => void
  paramBase?: (paramId: number) => number
  paramPlus?: (paramId: number) => number
  addParam?: (paramId: number, value: number) => void
  param?: (paramId: number) => number
  paramMax?: (paramId: number) => number
}

/** MV `Game_Actor.paramMax` for max HP / MP, for games whose actors lack `paramMax` */
const ACTOR_VITAL_CAP = 9999

const g = () =>
  globalThis as unknown as {
    $gameParty?: {
      battleMembers?: () => Actor[]
      members?: () => Actor[]
      maxBattleMembers?: () => number
      addActor?: (actorId: number) => void
      removeActor?: (actorId: number) => void
    }
    $dataActors?: (object | null)[]
    BattleManager?: { refreshStatus?: () => void }
  }

const whole = (n: number) => Math.max(0, Math.floor(Number(n) || 0))

export function readParty(): BattleActorState[] {
  const members = g().$gameParty?.battleMembers?.() ?? []
  return members.map((actor) => ({
    actorId: actor.actorId(),
    name: String(actor.name() ?? ''),
    hp: whole(actor.hp),
    mhp: whole(actor.mhp),
    mp: whole(actor.mp),
    mmp: whole(actor.mmp),
    mhpCap: paramCap(actor, 0, ACTOR_VITAL_CAP),
    mmpCap: paramCap(actor, 1, ACTOR_VITAL_CAP),
    tp: whole(actor.tp ?? 0),
    maxTp: whole(actor.maxTp?.() ?? 100),
    alive: actor.isAlive(),
  }))
}

/** Every party actor id (reserve included) and the battle member cap */
export function readPartyRoster(): { partyIds: number[]; partyMax: number } {
  const party = g().$gameParty
  return { partyIds: (party?.members?.() ?? []).map((a) => a.actorId()), partyMax: party?.maxBattleMembers?.() ?? 4 }
}

/** Same as the Change Party Member command; the new member acts from the next turn */
export function joinActor({ actorId }: { actorId: number }): void {
  assertBattleEditable()
  const party = g().$gameParty
  if (typeof party?.addActor !== 'function' || typeof party.battleMembers !== 'function') throw new Error('游戏未就绪')
  if (!(actorId > 0 && g().$dataActors?.[actorId])) throw new Error(`角色 ${actorId} 不存在`)
  const { partyIds, partyMax } = readPartyRoster()
  if (partyIds.includes(actorId)) throw new Error('该角色已在队伍中')
  if (party.battleMembers().length >= partyMax) throw new Error(`出战人数已满（${partyMax}）`)
  party.addActor(actorId)
  // Hidden members (some plugins) still take battle slots, so the actor may have landed in reserve
  if (!party.battleMembers().some((a) => a.actorId() === actorId)) {
    party.removeActor?.(actorId)
    throw new Error('出战位已被占满（可能有隐藏成员），无法加入')
  }
  refreshStatus()
}

function battleActor(actorId: number): Actor {
  assertBattleEditable()
  const actor = g()
    .$gameParty?.battleMembers?.()
    .find((a) => a.actorId() === actorId)
  if (!actor) throw new Error('该角色不在战斗中')
  return actor
}

/** The status window only redraws after actions; edits would otherwise show stale numbers */
function refreshStatus() {
  g().BattleManager?.refreshStatus?.()
}

/** Current values clamp to the cap; HP 0 knocks the actor out through the engine's `refresh` */
export function writeActorVital({ actorId, key, value }: { actorId: number; key: ActorVitalKey; value: number }): void {
  const actor = battleActor(actorId)
  if (!Number.isFinite(value)) throw new Error('数值无效')
  if (!actor.isAlive()) throw new Error('该角色已倒下')
  const n = Math.floor(value)
  if (key === 'mhp') writeMaxParam(actor, 0, n)
  else if (key === 'mmp') writeMaxParam(actor, 1, n)
  else if (key === 'mp') actor.setMp(Math.max(0, Math.min(n, actor.mmp)))
  else if (key === 'tp') {
    if (typeof actor.setTp !== 'function') throw new Error('游戏未就绪')
    actor.setTp(Math.max(0, Math.min(n, actor.maxTp?.() ?? 100)))
  } else if (key === 'hp') {
    actor.setHp(Math.max(0, Math.min(n, actor.mhp)))
    if (actor.isDead?.()) actor.performCollapse?.()
  } else {
    throw new Error(`未知属性：${String(key)}`)
  }
  refreshStatus()
  if (key === 'hp' && actor.isDead?.()) settleBattleEnd()
}

/** Lifts the death state (which also runs `revive`) */
function liftDeath(actor: Actor) {
  if (typeof actor.removeState === 'function' && typeof actor.deathStateId === 'function') actor.removeState(actor.deathStateId())
}

export function reviveActor({ actorId }: { actorId: number }): void {
  const actor = battleActor(actorId)
  if (actor.isAlive()) throw new Error('该角色未倒下')
  liftDeath(actor)
  actor.setHp(Math.max(1, actor.mhp))
  refreshStatus()
}

/** Full HP / MP; a fallen actor is revived first */
export function recoverActor({ actorId }: { actorId: number }): void {
  const actor = battleActor(actorId)
  if (!actor.isAlive()) liftDeath(actor)
  actor.setHp(Math.max(1, actor.mhp))
  actor.setMp(actor.mmp)
  refreshStatus()
}
