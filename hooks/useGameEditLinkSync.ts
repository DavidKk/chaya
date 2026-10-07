'use client'

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

import {
  type ActorDraft,
  type ActorVitalLockKind,
  countKey,
  defaultActorDraft,
  emptySession,
  GOLD_LOCK_KEY,
  type ItemKind,
  lockKeyForActorSkill,
  lockKeyForActorState,
  lockKeyForActorVital,
  lockKeyForCount,
  lockKeyForSwitch,
  lockKeyForVar,
  type RunActionId,
  type RunFlagKey,
  type SessionState,
  type TableRow,
} from '@/components/game-edit'
import { useGameLinkContext } from '@/components/GameLinkProvider'
import { battleSignature, type BattleState } from '@/lib/game/battle'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { EDIT_CMD_GIVE_UP_MS, EDIT_CMD_RETRY_MS, type EditPendingMap, expectForEditCmd, fieldsForEditCmd, mergeRemoteSession, newEditCmdId } from '@/lib/runtime/game-edit-sync'
import type { GameEditAck, GameEditCmd, GameEditCmdOp, GameEditStateMsg } from '@/lib/runtime/game-link-protocol'

type SetSession = Dispatch<SetStateAction<SessionState>>
type AckWaiter = { timer: number; finish: (ack: GameEditAck) => void; reject: (error: Error) => void }

/** Scene / map fields pushed with every `edit.state` */
export type GameLiveScene = {
  onMap: boolean
  mapId: number
  playerX: number
  playerY: number
  playerDir: number
  recentMaps: number[]
  runningCommon: number[]
  battle: BattleState | null
}

const EMPTY_SCENE: GameLiveScene = { onMap: false, mapId: 0, playerX: 0, playerY: 0, playerDir: 0, recentMaps: [], runningCommon: [], battle: null }

function sameList(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function sceneFrom(msg: GameEditStateMsg, prev: GameLiveScene): GameLiveScene {
  const next: GameLiveScene = {
    onMap: !!msg.onMap,
    mapId: msg.mapId ?? 0,
    playerX: msg.playerX ?? 0,
    playerY: msg.playerY ?? 0,
    playerDir: msg.playerDir ?? 0,
    recentMaps: msg.recentMaps ?? [],
    runningCommon: msg.runningCommon ?? [],
    battle: msg.battle ?? null,
  }
  const same =
    next.onMap === prev.onMap &&
    next.mapId === prev.mapId &&
    next.playerX === prev.playerX &&
    next.playerY === prev.playerY &&
    next.playerDir === prev.playerDir &&
    sameList(next.recentMaps, prev.recentMaps) &&
    sameList(next.runningCommon, prev.runningCommon) &&
    battleSignature(next.battle) === battleSignature(prev.battle)
  return same ? prev : next
}

/**
 * 作弊页：连上后订阅 edit.state；改动带 cmdId，pending 字段不被旧快照覆盖；ack / 快照匹配后放行。
 */
export function useGameEditLinkSync(setSession: SetSession, setLiveError: (msg: string) => void, onCatalog?: (catalog: GameEditCatalog) => void) {
  const { roomId, connected, send, subscribeMessages, acquireEditSession } = useGameLinkContext()
  const [synced, setSynced] = useState(false)
  const [scene, setScene] = useState<GameLiveScene>(EMPTY_SCENE)
  const ackWaitersRef = useRef(new Map<string, AckWaiter>())
  const catalogRef = useRef(onCatalog)
  catalogRef.current = onCatalog
  useEffect(() => {
    setSynced(false)
    setSession((prev) => ({ ...emptySession(), hotkeys: prev.hotkeys, hotkeysGlobal: prev.hotkeysGlobal }))
  }, [roomId, setSession])
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const pendingRef = useRef<EditPendingMap>(new Map())
  const sendRef = useRef(send)
  sendRef.current = send

  const clearFields = useCallback((fields: string[], onlyCmdId?: string) => {
    const map = pendingRef.current
    for (const field of fields) {
      const cur = map.get(field)
      if (!cur) continue
      if (onlyCmdId && cur.cmdId !== onlyCmdId) continue
      map.delete(field)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeMessages((msg) => {
      if (msg.type === 'edit.catalog') {
        catalogRef.current?.(msg.catalog)
        return
      }
      if (msg.type === 'edit.ack') {
        clearFields(msg.fields, msg.cmdId)
        const waiter = ackWaitersRef.current.get(msg.cmdId)
        if (waiter) {
          ackWaitersRef.current.delete(msg.cmdId)
          waiter.finish(msg)
        }
        return
      }
      if (msg.type !== 'edit.state') return
      setSynced(msg.ready)
      setScene((prev) => sceneFrom(msg, prev))
      setSession((prev) => {
        const { session, matchedFields } = mergeRemoteSession(prev, msg.session, pendingRef.current)
        if (matchedFields.length) clearFields(matchedFields)
        return session
      })
      setLiveError(msg.ready ? '' : msg.error || '游戏未就绪')
    })
    const pending = pendingRef.current
    const release = connected ? acquireEditSession() : null
    if (!connected) {
      pending.clear()
      setSynced(false)
      setScene(EMPTY_SCENE)
    }
    return () => {
      unsubscribe()
      release?.()
      pending.clear()
    }
  }, [connected, roomId, subscribeMessages, acquireEditSession, setSession, setLiveError, clearFields])

  useEffect(
    () => () => {
      const error = new Error('游戏连接已断开')
      for (const waiter of ackWaitersRef.current.values()) {
        window.clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      ackWaitersRef.current.clear()
    },
    [connected, roomId]
  )

  /** 未 ack 的命令定时重发；超时放弃 pending 以免永久卡住 */
  useEffect(() => {
    if (!connected) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      const map = pendingRef.current
      const byCmd = new Map<string, GameEditCmd>()
      for (const [field, entry] of map) {
        if (now - entry.startedAt >= EDIT_CMD_GIVE_UP_MS) {
          map.delete(field)
          continue
        }
        if (now - entry.sentAt >= EDIT_CMD_RETRY_MS) byCmd.set(entry.cmdId, entry.cmd)
      }
      for (const cmd of byCmd.values()) {
        sendRef.current(cmd)
        const t = Date.now()
        for (const [field, entry] of map) {
          if (entry.cmdId === cmd.cmdId) map.set(field, { ...entry, sentAt: t })
        }
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [connected])

  const sendCmd = useCallback((op: GameEditCmdOp): string | null => {
    if (!connectedRef.current) return null
    const cmd: GameEditCmd = { type: 'edit.cmd', cmdId: newEditCmdId(), ...op }
    const fields = fieldsForEditCmd(cmd)
    const expect = expectForEditCmd(cmd)
    const sentAt = Date.now()
    const map = pendingRef.current
    for (const field of fields) {
      map.set(field, { cmdId: cmd.cmdId, expect, startedAt: sentAt, sentAt, cmd })
    }
    sendRef.current(cmd)
    return cmd.cmdId
  }, [])

  /** Send and wait for the game's ack; resolves with `ack.result`, rejects with the game's error message or on timeout */
  const runCmd = useCallback(
    (op: GameEditCmdOp) =>
      new Promise<unknown>((resolve, reject) => {
        const cmdId = sendCmd(op)
        if (!cmdId) return reject(new Error('游戏未连接'))
        const waiters = ackWaitersRef.current
        const timer = window.setTimeout(() => {
          waiters.delete(cmdId)
          reject(new Error('游戏无响应'))
        }, EDIT_CMD_GIVE_UP_MS)
        waiters.set(cmdId, {
          timer,
          reject,
          finish: (ack) => {
            window.clearTimeout(timer)
            if (ack.ok) resolve(ack.result)
            else reject(new Error(ack.error || '操作失败'))
          },
        })
      }),
    [sendCmd]
  )

  const requestCatalog = useCallback(() => send({ type: 'edit.catalog.request' }), [send])
  return { linked: connected && synced, connected, scene, sendCmd, runCmd, requestCatalog }
}

export function buildOptimisticHandlers(setSession: SetSession, sendCmd: (op: GameEditCmdOp) => void, catalogActorName?: (id: number) => string | undefined) {
  const setGold = (next: number) => {
    const n = Math.max(0, Math.floor(next))
    sendCmd({ op: 'gold', value: n })
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (GOLD_LOCK_KEY in locks) locks[GOLD_LOCK_KEY] = n
      return { ...prev, gold: n, locks }
    })
  }

  const setGoldLock = (on: boolean) => {
    setSession((prev) => {
      sendCmd({ op: 'goldLock', on, value: prev.gold })
      const locks = { ...prev.locks }
      if (on) locks[GOLD_LOCK_KEY] = prev.gold
      else delete locks[GOLD_LOCK_KEY]
      return { ...prev, locks }
    })
  }

  const setCount = (kind: ItemKind, id: number, next: number) => {
    const key = countKey(kind, id)
    const n = Math.max(0, Math.floor(next))
    sendCmd({ op: 'count', kind, id, value: n })
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (key in locks) locks[key] = n
      return { ...prev, counts: { ...prev.counts, [key]: n }, locks }
    })
  }

  const setVar = (id: number, next: number) => {
    const n = Math.floor(next)
    sendCmd({ op: 'var', id, value: n })
    const key = lockKeyForVar(id)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (key in locks) locks[key] = n
      return { ...prev, vars: { ...prev.vars, [id]: n }, locks }
    })
  }

  const setSwitch = (id: number, next: boolean) => {
    sendCmd({ op: 'sw', id, value: next })
    const key = lockKeyForSwitch(id)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (key in locks) locks[key] = next ? 1 : 0
      return { ...prev, switches: { ...prev.switches, [id]: next }, locks }
    })
  }

  const setRowLock = (row: TableRow, on: boolean) => {
    if (row.valueType === 'count' && row.kind) {
      const value = Number(row.value) || 0
      sendCmd({ op: 'countLock', kind: row.kind, id: row.id, on, value })
      const key = lockKeyForCount(row.kind, row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = value
        else delete locks[key]
        return { ...prev, locks }
      })
      return
    }
    if (row.valueType === 'var') {
      const value = Number(row.value) || 0
      sendCmd({ op: 'varLock', id: row.id, on, value })
      const key = lockKeyForVar(row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = value
        else delete locks[key]
        return { ...prev, locks }
      })
      return
    }
    if (row.valueType === 'sw') {
      const value = row.value ? 1 : 0
      sendCmd({ op: 'swLock', id: row.id, on, value })
      const key = lockKeyForSwitch(row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = value
        else delete locks[key]
        return { ...prev, locks }
      })
    }
  }

  const setActorOwnedLock = (actorId: number, kind: 'skills' | 'states', entryId: number, on: boolean) => {
    const key = kind === 'skills' ? lockKeyForActorSkill(actorId, entryId) : lockKeyForActorState(actorId, entryId)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (!on) {
        delete locks[key]
        sendCmd({ op: 'actorOwnedLock', actorId, kind, entryId, on: false, owned: false })
        return { ...prev, locks }
      }
      const draft = prev.actors[actorId]
      const owned = kind === 'skills' ? (draft?.skillIds || []).includes(entryId) : (draft?.stateIds || []).includes(entryId)
      locks[key] = owned ? 1 : 0
      sendCmd({ op: 'actorOwnedLock', actorId, kind, entryId, on: true, owned })
      return { ...prev, locks }
    })
  }

  const setActorVitalLock = (actorId: number, kind: ActorVitalLockKind, on: boolean) => {
    const key = lockKeyForActorVital(kind, actorId)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (!on) {
        delete locks[key]
        sendCmd({ op: 'actorVitalLock', actorId, kind, on: false, value: 0 })
        return { ...prev, locks }
      }
      const draft = prev.actors[actorId]
      const value = kind === 'level' ? (draft?.level ?? 1) : kind === 'exp' ? (draft?.exp ?? 0) : kind === 'hp' ? (draft?.hp ?? 0) : (draft?.mp ?? 0)
      locks[key] = value
      sendCmd({ op: 'actorVitalLock', actorId, kind, on: true, value })
      return { ...prev, locks }
    })
  }

  const setActor = (id: number, patch: Partial<ActorDraft>) => {
    sendCmd({ op: 'actor', id, patch })
    setSession((prev) => {
      const base = prev.actors[id] || defaultActorDraft(id, catalogActorName?.(id))
      const next = { ...base, ...patch }
      const locks = { ...prev.locks }
      if (patch.skillIds) {
        const owned = new Set(next.skillIds)
        for (const key of Object.keys(locks)) {
          if (!key.startsWith(`actorSkill:${id}:`)) continue
          const skillId = Number(key.slice(`actorSkill:${id}:`.length))
          if (Number.isFinite(skillId)) locks[key] = owned.has(skillId) ? 1 : 0
        }
      }
      if (patch.stateIds) {
        const owned = new Set(next.stateIds)
        for (const key of Object.keys(locks)) {
          if (!key.startsWith(`actorState:${id}:`)) continue
          const stateId = Number(key.slice(`actorState:${id}:`.length))
          if (Number.isFinite(stateId)) locks[key] = owned.has(stateId) ? 1 : 0
        }
      }
      for (const kind of ['level', 'exp', 'hp', 'mp'] as const) {
        const key = lockKeyForActorVital(kind, id)
        if (!(key in locks)) continue
        locks[key] = kind === 'level' ? next.level : kind === 'exp' ? next.exp : kind === 'hp' ? next.hp : next.mp
      }
      return { ...prev, actors: { ...prev.actors, [id]: next }, locks }
    })
  }

  const setMoveRate = (rate: number) => {
    sendCmd({ op: 'moveRate', value: rate })
    setSession((prev) => ({ ...prev, walkRate: rate, runRate: rate }))
  }
  const setGameSpeed = (rate: number) => {
    sendCmd({ op: 'gameSpeed', value: rate })
    setSession((prev) => ({ ...prev, gameSpeed: rate }))
  }
  const setExpRate = (rate: number) => {
    sendCmd({ op: 'expRate', value: rate })
    setSession((prev) => ({ ...prev, expRate: rate }))
  }
  const setRunFlag = (key: RunFlagKey, on: boolean) => {
    sendCmd({ op: 'runFlag', key, value: on })
    setSession((prev) => ({ ...prev, [key]: on }))
  }
  const runAction = (id: RunActionId) => {
    sendCmd({ op: 'runAction', id })
  }

  return {
    setGold,
    setGoldLock,
    setCount,
    setVar,
    setSwitch,
    setRowLock,
    setActorOwnedLock,
    setActorVitalLock,
    setActor,
    setMoveRate,
    setGameSpeed,
    setExpRate,
    setRunFlag,
    runAction,
  }
}
