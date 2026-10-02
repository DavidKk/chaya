/** Web ↔ 游戏 edit 同步：字段键、pending 合并（非墙钟） */

import {
  type ActorDraft,
  countKey,
  GOLD_LOCK_KEY,
  lockKeyForActorSkill,
  lockKeyForActorState,
  lockKeyForActorVital,
  lockKeyForCount,
  lockKeyForSwitch,
  lockKeyForVar,
  RUN_FLAG_KEYS,
  type RunFlagKey,
  type SessionState,
} from '@/components/game-edit/types'
import type { GameEditCmd } from '@/lib/runtime/game-link-protocol'

export type EditPendingEntry = {
  cmdId: string
  /** 期望值（标量核对用；复杂字段可空） */
  expect?: unknown
  sentAt: number
  cmd: GameEditCmd
}

export type EditPendingMap = Map<string, EditPendingEntry>

/** 本命令影响的会话字段键（Web pending / Game ack 共用） */
export function fieldsForEditCmd(cmd: GameEditCmd): string[] {
  switch (cmd.op) {
    case 'gold':
      return ['gold']
    case 'goldLock':
      return [`lock:${GOLD_LOCK_KEY}`]
    case 'count':
      return [`count:${countKey(cmd.kind, cmd.id)}`]
    case 'countLock':
      return [`lock:${lockKeyForCount(cmd.kind, cmd.id)}`]
    case 'var':
      return [`var:${cmd.id}`]
    case 'varLock':
      return [`lock:${lockKeyForVar(cmd.id)}`]
    case 'sw':
      return [`sw:${cmd.id}`]
    case 'swLock':
      return [`lock:${lockKeyForSwitch(cmd.id)}`]
    case 'runFlag':
      return [`runFlag:${cmd.key}`]
    case 'runAction':
      return [`action:${cmd.id}`]
    case 'walkRate':
      return ['walkRate']
    case 'runRate':
      return ['runRate']
    case 'expRate':
      return ['expRate']
    case 'actor':
      return [`actor:${cmd.id}`]
    case 'actorVitalLock':
      return [`lock:${lockKeyForActorVital(cmd.kind, cmd.actorId)}`]
    case 'actorOwnedLock': {
      const key = cmd.kind === 'skills' ? lockKeyForActorSkill(cmd.actorId, cmd.entryId) : lockKeyForActorState(cmd.actorId, cmd.entryId)
      return [`lock:${key}`]
    }
    default:
      return []
  }
}

/** 从命令提取期望值（用于快照回声核对） */
export function expectForEditCmd(cmd: GameEditCmd): unknown {
  switch (cmd.op) {
    case 'gold':
    case 'walkRate':
    case 'runRate':
    case 'expRate':
      return cmd.value
    case 'count':
    case 'var':
      return cmd.value
    case 'sw':
    case 'runFlag':
      return cmd.value
    case 'goldLock':
    case 'countLock':
    case 'varLock':
    case 'swLock':
    case 'actorVitalLock':
      return cmd.on ? cmd.value : null
    case 'actorOwnedLock':
      return cmd.on ? (cmd.owned ? 1 : 0) : null
    case 'actor':
      return cmd.patch
    case 'runAction':
      return true
    default:
      return undefined
  }
}

function remoteMatchesExpect(remote: Omit<SessionState, 'hotkeys' | 'hotkeysGlobal'>, field: string, expect: unknown): boolean {
  if (expect === undefined) return false
  if (field === 'gold') return remote.gold === expect
  if (field === 'walkRate') return remote.walkRate === expect
  if (field === 'runRate') return remote.runRate === expect
  if (field === 'expRate') return remote.expRate === expect
  if (field.startsWith('count:')) {
    const key = field.slice('count:'.length)
    return (remote.counts[key] ?? 0) === expect
  }
  if (field.startsWith('var:')) {
    const id = Number(field.slice(4))
    return (remote.vars[id] ?? 0) === expect
  }
  if (field.startsWith('sw:')) {
    const id = Number(field.slice(3))
    return !!remote.switches[id] === !!expect
  }
  if (field.startsWith('runFlag:')) {
    const key = field.slice('runFlag:'.length) as RunFlagKey
    return !!remote[key] === !!expect
  }
  if (field.startsWith('lock:')) {
    const key = field.slice(5)
    if (expect === null) return !(key in remote.locks)
    return remote.locks[key] === expect
  }
  if (field.startsWith('actor:')) {
    const id = Number(field.slice(6))
    const draft = remote.actors[id]
    if (!draft || !expect || typeof expect !== 'object') return false
    const patch = expect as Partial<ActorDraft>
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      const cur = draft[k as keyof ActorDraft]
      if (Array.isArray(v) && Array.isArray(cur)) {
        if (v.length !== cur.length || v.some((x, i) => x !== cur[i])) return false
      } else if (cur !== v) return false
    }
    return true
  }
  // action:* 无会话字段可核对
  return false
}

/**
 * 合并远程快照：pending 字段保留本地乐观值；若远程已达 expect 则视为落地（ack 丢失时的补偿）。
 * 返回 next session，以及因「快照匹配」可清除的 field 列表。
 */
export function mergeRemoteSession(
  prev: SessionState,
  remote: Omit<SessionState, 'hotkeys' | 'hotkeysGlobal'>,
  pending: EditPendingMap
): { session: SessionState; matchedFields: string[] } {
  const matchedFields: string[] = []
  for (const [field, entry] of pending) {
    if (entry.expect !== undefined && remoteMatchesExpect(remote, field, entry.expect)) {
      matchedFields.push(field)
    }
  }
  const blocked = new Set<string>()
  for (const [field] of pending) {
    if (!matchedFields.includes(field)) blocked.add(field)
  }

  const next: SessionState = {
    ...prev,
    ...remote,
    hotkeys: prev.hotkeys,
    hotkeysGlobal: prev.hotkeysGlobal,
    counts: { ...remote.counts },
    vars: { ...remote.vars },
    switches: { ...remote.switches },
    locks: { ...remote.locks },
    actors: { ...remote.actors },
  }

  if (blocked.has('gold')) next.gold = prev.gold
  if (blocked.has('walkRate')) next.walkRate = prev.walkRate
  if (blocked.has('runRate')) next.runRate = prev.runRate
  if (blocked.has('expRate')) next.expRate = prev.expRate

  for (const key of RUN_FLAG_KEYS) {
    if (blocked.has(`runFlag:${key}`)) next[key] = prev[key]
  }

  for (const field of blocked) {
    if (field.startsWith('count:')) {
      const ck = field.slice('count:'.length)
      if (ck in prev.counts) next.counts[ck] = prev.counts[ck]!
      else delete next.counts[ck]
    } else if (field.startsWith('var:')) {
      const id = Number(field.slice(4))
      if (id in prev.vars) next.vars[id] = prev.vars[id]!
      else delete next.vars[id]
    } else if (field.startsWith('sw:')) {
      const id = Number(field.slice(3))
      if (id in prev.switches) next.switches[id] = prev.switches[id]!
      else delete next.switches[id]
    } else if (field.startsWith('lock:')) {
      const lk = field.slice(5)
      if (lk in prev.locks) next.locks[lk] = prev.locks[lk]!
      else delete next.locks[lk]
    } else if (field.startsWith('actor:')) {
      const id = Number(field.slice(6))
      if (prev.actors[id]) next.actors[id] = prev.actors[id]!
      else delete next.actors[id]
    }
  }

  return { session: next, matchedFields }
}

export function newEditCmdId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const EDIT_CMD_RETRY_MS = 1_500
export const EDIT_CMD_GIVE_UP_MS = 8_000
