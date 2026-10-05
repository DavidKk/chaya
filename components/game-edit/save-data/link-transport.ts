'use client'

import { useEffect, useRef, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { type DataDiff, DataError, type DataErrorCode, type DataOp, type DataStatus, type SearchBatch } from '@/lib/game/save-data'
import type { GameEditCmdOp, GameLinkMessage } from '@/lib/runtime/game-link-protocol'

import { draftStore, markAllStale, valueStore, writtenStore } from './store'
import type { SaveDataTransport } from './transport'

const REQUEST_TIMEOUT_MS = 15_000

type Pending = { resolve: (msg: GameLinkMessage) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }

type Deps = {
  send: (msg: GameLinkMessage) => void
  subscribe: (fn: (msg: GameLinkMessage) => void) => () => void
  runCmd: (op: GameEditCmdOp) => Promise<unknown>
}

let reqSeq = 0
let storeRoomId: string | null = null
const nextReqId = () => `d-${Date.now().toString(36)}-${++reqSeq}`

function toError(msg: { error?: string; code?: DataErrorCode; existingDepth?: number }): DataError {
  return new DataError(msg.error || '读取失败', msg.code, msg.existingDepth)
}

/** Data page over the game link: reads by `reqId`, writes through the edit command channel */
export function createLinkTransport({ send, subscribe, runCmd }: Deps): SaveDataTransport & { dispose(): void } {
  const pending = new Map<string, Pending>()
  const diffSubs = new Set<(diff: DataDiff) => void>()
  const statusSubs = new Set<(status: DataStatus) => void>()
  const searchSubs = new Map<string, (batch: SearchBatch) => void>()

  const unsubscribe = subscribe((msg) => {
    switch (msg.type) {
      case 'data.page':
      case 'data.value':
      case 'data.rows.result': {
        const p = pending.get(msg.reqId)
        if (!p) return
        pending.delete(msg.reqId)
        clearTimeout(p.timer)
        p.resolve(msg)
        return
      }
      case 'data.diff': {
        const { type: _type, ...diff } = msg
        for (const cb of diffSubs) cb(diff)
        return
      }
      case 'data.status': {
        const { type: _type, ...status } = msg
        for (const cb of statusSubs) cb(status)
        return
      }
      case 'data.search.hits': {
        const { type: _type, reqId, ...batch } = msg
        const cb = searchSubs.get(reqId)
        if (!cb) return
        if (batch.done) searchSubs.delete(reqId)
        cb(batch)
        return
      }
      default:
        return
    }
  })

  function request<T extends GameLinkMessage>(msg: GameLinkMessage & { reqId: string }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(msg.reqId)
        reject(new DataError('游戏无响应', undefined))
      }, REQUEST_TIMEOUT_MS)
      pending.set(msg.reqId, { resolve: (m) => resolve(m as T), reject, timer })
      try {
        send(msg)
      } catch (err) {
        clearTimeout(timer)
        pending.delete(msg.reqId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  return {
    async list(path, offset, limit) {
      const res = await request<Extract<GameLinkMessage, { type: 'data.page' }>>({ type: 'data.list', reqId: nextReqId(), path, offset, limit })
      if (!res.ok) throw toError(res)
      return res.page
    },
    async read(path) {
      const res = await request<Extract<GameLinkMessage, { type: 'data.value' }>>({ type: 'data.read', reqId: nextReqId(), path })
      if (!res.ok || !res.cell) throw toError(res)
      return res.cell
    },
    async rows(paths) {
      const res = await request<Extract<GameLinkMessage, { type: 'data.rows.result' }>>({ type: 'data.rows', reqId: nextReqId(), paths })
      if (!res.ok || !res.rows) throw toError(res)
      return res.rows
    },
    watch(sid, entries) {
      try {
        send({ type: 'data.watch', sid, entries })
      } catch {
        /* link down: the page re-watches after reconnecting */
      }
    },
    onDiff(cb) {
      diffSubs.add(cb)
      return () => diffSubs.delete(cb)
    },
    onStatus(cb) {
      statusSubs.add(cb)
      return () => statusSubs.delete(cb)
    },
    requestStatus() {
      try {
        send({ type: 'data.status.request' })
      } catch {
        /* */
      }
    },
    search(path, query, scope, onBatch) {
      const reqId = nextReqId()
      searchSubs.set(reqId, onBatch)
      try {
        send({ type: 'data.search', reqId, path, query, scope })
      } catch {
        searchSubs.delete(reqId)
        onBatch({ hits: [], done: true, truncated: false, scanned: 0 })
      }
      return () => {
        if (!searchSubs.delete(reqId)) return
        try {
          send({ type: 'data.search.cancel', reqId })
        } catch {
          /* */
        }
      }
    },
    run(op: DataOp) {
      return runCmd(op)
    },
    dispose() {
      unsubscribe()
      try {
        send({ type: 'data.watch', sid: 0, entries: [] })
        for (const reqId of searchSubs.keys()) send({ type: 'data.search.cancel', reqId })
      } catch {
        /* link already down */
      }
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.reject(new DataError('游戏连接已断开'))
      }
      pending.clear()
      diffSubs.clear()
      statusSubs.clear()
      searchSubs.clear()
    },
  }
}

/** Link transport while connected; null otherwise */
export function useLinkSaveDataTransport(enabled: boolean, runCmd: (op: GameEditCmdOp) => Promise<unknown>): SaveDataTransport | null {
  const { roomId, connected, send, subscribeMessages } = useGameLinkContext()
  const [transport, setTransport] = useState<(SaveDataTransport & { dispose(): void }) | null>(null)
  const runCmdRef = useRef(runCmd)
  const linkRef = useRef({ roomId, connected })
  runCmdRef.current = runCmd
  useEffect(() => {
    const previous = linkRef.current
    const roomChanged = (previous.roomId != null && previous.roomId !== roomId) || (storeRoomId != null && storeRoomId !== roomId)
    const disconnected = previous.connected && !connected
    linkRef.current = { roomId, connected }
    if (roomId != null) storeRoomId = roomId
    if (!roomChanged && !disconnected) return
    valueStore.clear()
    writtenStore.clear()
    if (draftStore.size) markAllStale()
  }, [roomId, connected])
  useEffect(() => {
    if (!enabled || !connected) {
      setTransport(null)
      return
    }
    const next = createLinkTransport({ send, subscribe: subscribeMessages, runCmd: (op) => runCmdRef.current(op) })
    setTransport(next)
    return () => next.dispose()
  }, [enabled, connected, roomId, send, subscribeMessages])
  return transport
}
