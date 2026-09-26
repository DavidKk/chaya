/**
 * Console `ChayaEdit.actor(id)` chainable API.
 */
import { createLogger } from '../../helpers'

const log = createLogger('ChayaEdit')

const PARAM_KEYS = ['mhp', 'mmp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'] as const

export function actorApi(actorId: number) {
  const actor = $gameActors && $gameActors.actor(actorId)
  if (!actor) {
    log.warn('无效角色 ID', actorId)
    return null
  }
  const api: Record<string, unknown> = {
    id: actorId,
    raw: actor,
    level(n?: number) {
      if (n != null) {
        const target = Math.max(1, Number(n))
        while (actor.level < target) actor.changeExp(actor.nextLevelExp(), false)
        while (actor.level > target && actor.level > 1) {
          actor.changeExp(Math.max(0, actor.currentLevelExp() - 1), false)
        }
      }
      return api
    },
    hp(n?: number) {
      if (n == null) actor.setHp(actor.mhp)
      else actor.setHp(Number(n))
      return api
    },
    mp(n?: number) {
      if (n == null) actor.setMp(actor.mmp)
      else actor.setMp(Number(n))
      return api
    },
    name(n?: string) {
      if (n != null) actor.setName(String(n))
      return actor.name()
    },
    nickname(n?: string) {
      if (n != null && typeof actor.setNickname === 'function') actor.setNickname(String(n))
      return typeof actor.nickname === 'function' ? actor.nickname() : actor._nickname || ''
    },
    profile(n?: string) {
      if (n != null && typeof actor.setProfile === 'function') actor.setProfile(String(n))
      return typeof actor.profile === 'function' ? actor.profile() : actor._profile || ''
    },
    exp(n?: number) {
      if (n != null && typeof actor.changeExp === 'function') {
        const target = Math.max(0, Math.floor(Number(n)))
        actor.changeExp(target, false)
      }
      return typeof actor.currentExp === 'function' ? actor.currentExp() : 0
    },
    classId(n?: number, keepExp = true) {
      if (n != null && typeof actor.changeClass === 'function') {
        actor.changeClass(Math.floor(Number(n)), keepExp !== false)
      }
      return actor._classId
    },
    /** @deprecated Same as classId */
    class(n?: number, keepExp = true) {
      return (api.classId as (n?: number, keepExp?: boolean) => unknown)(n, keepExp)
    },
    learn(skillId: number) {
      actor.learnSkill(Math.floor(Number(skillId)))
      return api
    },
    forget(skillId: number) {
      actor.forgetSkill(Math.floor(Number(skillId)))
      return api
    },
    addState(stateId: number) {
      actor.addState(Math.floor(Number(stateId)))
      return api
    },
    removeState(stateId: number) {
      actor.removeState(Math.floor(Number(stateId)))
      return api
    },
    clearStates() {
      if (typeof actor.clearStates === 'function') actor.clearStates()
      return api
    },
    setSkills(ids: number[]) {
      const want = new Set((ids || []).map((x) => Math.floor(Number(x))).filter((x) => x > 0))
      const have = new Set((actor.skills() || []).map((s: { id?: number }) => s && s.id).filter(Boolean) as number[])
      for (const id of have) if (!want.has(id)) actor.forgetSkill(id)
      for (const id of want) if (!have.has(id)) actor.learnSkill(id)
      return api
    },
    setStates(ids: number[]) {
      const want = new Set((ids || []).map((x) => Math.floor(Number(x))).filter((x) => x > 0))
      const have = new Set((actor.states() || []).map((s: { id?: number }) => s && s.id).filter(Boolean) as number[])
      for (const id of have) if (!want.has(id)) actor.removeState(id)
      for (const id of want) if (!have.has(id)) actor.addState(id)
      return api
    },
    /** slotId from 0; itemId=0 unequips. If not owned, gain into inventory then forceChangeEquip */
    equip(slotId: number, itemId: number) {
      const slot = Math.floor(Number(slotId))
      const iid = Math.floor(Number(itemId) || 0)
      if (iid <= 0) {
        if (typeof actor.forceChangeEquip === 'function') actor.forceChangeEquip(slot, null)
        else actor.changeEquip(slot, null)
        return api
      }
      const slots = actor.equipSlots()
      const etype = slots[slot]
      const item = etype === 1 ? $dataWeapons[iid] : $dataArmors[iid]
      if (!item) return api
      if ($gameParty && !$gameParty.hasItem(item)) $gameParty.gainItem(item, 1)
      if (typeof actor.forceChangeEquip === 'function') actor.forceChangeEquip(slot, item)
      else actor.changeEquip(slot, item)
      return api
    },
    /** Set final param value via addParam delta; paramId 0–7 */
    param(paramId: number, n?: number) {
      const id = Number(paramId)
      if (id < 0 || id > 7) {
        log.warn('无效属性 ID', paramId)
        return null
      }
      if (n != null) {
        const target = Math.floor(Number(n))
        const cur = actor.param(id)
        if (target !== cur) actor.addParam(id, target - cur)
      }
      return actor.param(id)
    },
    status() {
      const o: Record<string, unknown> = {
        id: actorId,
        name: actor.name(),
        nickname: typeof actor.nickname === 'function' ? actor.nickname() : actor._nickname || '',
        profile: typeof actor.profile === 'function' ? actor.profile() : actor._profile || '',
        level: actor.level,
        exp: typeof actor.currentExp === 'function' ? actor.currentExp() : 0,
        hp: `${actor.hp}/${actor.mhp}`,
        mp: `${actor.mp}/${actor.mmp}`,
        classId: actor._classId,
        skills: (actor.skills() || []).map((s: { id?: number }) => s && s.id).filter(Boolean),
        states: (actor.states() || []).map((s: { id?: number }) => s && s.id).filter(Boolean),
      }
      for (let i = 0; i < 8; i++) o[PARAM_KEYS[i]] = actor.param(i)
      return o
    },
    info() {
      return (api.status as () => unknown)()
    },
  }
  for (let i = 0; i < 8; i++) {
    const key = PARAM_KEYS[i]
    const pid = i
    api[key] = function (n?: number) {
      if (n != null) {
        ;(api.param as (id: number, n?: number) => unknown)(pid, n)
        return api
      }
      return actor.param(pid)
    }
  }
  return api
}
