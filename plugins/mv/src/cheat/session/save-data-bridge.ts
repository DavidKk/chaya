/**
 * Link side of the data page: `data.*` read requests, the web client's watcher and searches, and status pushes.
 * Data writes arrive as `edit.cmd` and are run by `runDataCmd` (called from remote-bridge).
 */
import { type DataError, type DataOp, isDataOp } from '@/lib/game/save-data'
import type { GameEditCmd, GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { sendChunked } from '@/lib/runtime/link-chunks'

import { SaveData, type Watcher } from './save-data'

type SendFn = (msg: GameLinkMessage) => void

let sendFn: SendFn | null = null
let watcher: Watcher | null = null
let offStatus: (() => void) | null = null
const searches = new Map<string, () => void>()

/** Keep each DataChannel message small: anything past a few KiB goes as `link.chunk` packets */
const DIRECT_MAX = 8_000

/** Chunked sends yield to the event loop and the receiver keeps few partial messages: once one is in flight, later messages queue behind it to keep their order */
let sendQueue: Promise<void> = Promise.resolve()
let queued = 0

export function sendSized(send: SendFn, msg: GameLinkMessage) {
  const small = JSON.stringify(msg).length <= DIRECT_MAX
  if (small && !queued) return send(msg)
  queued++
  sendQueue = sendQueue
    .then(() => (small ? send(msg) : sendChunked(send, msg)))
    .catch(() => {
      /* link closed mid-send; the client times out and retries */
    })
    .finally(() => {
      queued--
    })
}

const errorOf = (err: unknown) => ({
  error: err instanceof Error && err.message ? err.message : '读取失败',
  ...((err as DataError)?.code ? { code: (err as DataError).code } : {}),
  ...((err as DataError)?.existingDepth != null ? { existingDepth: (err as DataError).existingDepth } : {}),
})

function pushStatus() {
  try {
    if (sendFn) sendSized(sendFn, { type: 'data.status', ...SaveData.status() })
  } catch {
    /* link closed */
  }
}

function ensureStatusFeed() {
  if (!offStatus) offStatus = SaveData.onStatus(pushStatus)
}

function cancelSearches() {
  for (const cancel of searches.values()) cancel()
  searches.clear()
}

/** Returns true when the message belonged to the data page */
export function handleDataMessage(msg: GameLinkMessage, send: SendFn): boolean {
  if (!msg.type.startsWith('data.')) return false
  sendFn = send
  ensureStatusFeed()
  switch (msg.type) {
    case 'data.list':
      try {
        sendSized(send, { type: 'data.page', reqId: msg.reqId, ok: true, page: SaveData.list(msg.path, msg.offset, msg.limit) })
      } catch (err) {
        send({ type: 'data.page', reqId: msg.reqId, ok: false, ...errorOf(err) })
      }
      return true
    case 'data.read':
      try {
        sendSized(send, { type: 'data.value', reqId: msg.reqId, ok: true, cell: SaveData.read(msg.path) })
      } catch (err) {
        send({ type: 'data.value', reqId: msg.reqId, ok: false, ...errorOf(err) })
      }
      return true
    case 'data.rows':
      try {
        sendSized(send, { type: 'data.rows.result', reqId: msg.reqId, ok: true, rows: SaveData.rows(msg.paths) })
      } catch (err) {
        send({ type: 'data.rows.result', reqId: msg.reqId, ok: false, ...errorOf(err) })
      }
      return true
    case 'data.watch':
      if (!watcher) {
        watcher = SaveData.createWatcher((diff) => sendFn && sendSized(sendFn, { type: 'data.diff', ...diff }))
        pushStatus()
      }
      watcher.set(msg.sid, msg.entries)
      return true
    case 'data.search': {
      cancelSearches()
      const reqId = msg.reqId
      let finished = false
      try {
        const cancel = SaveData.search(msg.path, msg.query, msg.scope, (batch) => {
          if (batch.done) {
            finished = true
            searches.delete(reqId)
          }
          try {
            sendSized(send, { type: 'data.search.hits', reqId, ...batch })
          } catch {
            searches.get(reqId)?.()
            searches.delete(reqId)
          }
        })
        if (!finished) searches.set(reqId, cancel)
      } catch {
        send({ type: 'data.search.hits', reqId, hits: [], done: true, truncated: false, scanned: 0 })
      }
      return true
    }
    case 'data.search.cancel':
      searches.get(msg.reqId)?.()
      searches.delete(msg.reqId)
      return true
    case 'data.status.request':
      pushStatus()
      return true
    default:
      return true
  }
}

export function isDataCmd(cmd: GameEditCmd): cmd is GameEditCmd & DataOp {
  return isDataOp(cmd)
}

export function runDataCmd(cmd: GameEditCmd & DataOp): unknown {
  return SaveData.run(cmd)
}

export function stopDataBridge() {
  cancelSearches()
  watcher?.dispose()
  watcher = null
  offStatus?.()
  offStatus = null
  sendFn = null
}
