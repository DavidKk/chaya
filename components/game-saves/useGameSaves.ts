'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useGameToolTransport } from '@/components/game-tools/transport'
import {
  DEFAULT_GAME_SAVES_SETTINGS,
  type GameSaveEntry,
  type GameSavesErrorCode,
  type GameSavesOp,
  type GameSavesSettings,
  type GameSavesSnapshot,
  parseGameSavesSettings,
  type SaveWaitReason,
} from '@/lib/game/game-saves'
import { type MessageKey, tNow } from '@/lib/i18n'
import type { GameSavesMessage } from '@/lib/runtime/game-link-protocol'

type Reply = Extract<GameSavesMessage, { type: 'saves.reply' }>
type OkReply = Extract<Reply, { ok: true }>

const TIMEOUT_MS = { quick: 10_000, slow: 60_000 }
const SETTINGS_KEY = 'chaya:game-saves:settings'

const API_ERROR_KEY: Record<string, MessageKey> = { REVISION_CONFLICT: 'saves.error.revisionConflict', INVALID_SETTINGS: 'saves.error.invalidSettings' }

function readLocalSettings(): GameSavesSettings {
  try {
    return parseGameSavesSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'))
  } catch {
    return DEFAULT_GAME_SAVES_SETTINGS
  }
}

async function readSettings(localGlobal: boolean): Promise<GameSavesSettings> {
  if (localGlobal) return readLocalSettings()
  const response = await fetch('/api/game-saves/settings')
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || tNow('saves.error.settingsRead'))
  return parseGameSavesSettings(body.settings)
}

async function writeSettings(next: GameSavesSettings, expectedRevision: number, localGlobal: boolean): Promise<void> {
  if (localGlobal) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    return
  }
  const response = await fetch('/api/game-saves/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: next, expectedRevision }),
  })
  const body = await response.json()
  if (!response.ok) {
    const key = API_ERROR_KEY[body.error?.code]
    throw new Error(key ? tNow(key) : body.error?.message || tNow('saves.error.settingsWrite'))
  }
}

export class GameSavesCommandError extends Error {
  constructor(
    message: string,
    readonly code?: GameSavesErrorCode,
    readonly reason?: SaveWaitReason
  ) {
    super(message)
  }
}

/**
 * 游戏存档页的数据：通用设置、快照、状态推送与命令。
 * 设置所有游戏共用，未连接也能修改；连接后按 revision 采用较新的一份，游戏目录另存一份供游戏单独运行。
 * 存档的保存、读档、删除都由游戏侧执行。
 */
export function useGameSaves() {
  const { roomId, connected, negotiating, localGlobal, send, subscribeMessages } = useGameToolTransport()
  const [snapshot, setSnapshot] = useState<GameSavesSnapshot | null>(null)
  const [settings, setSettings] = useState<GameSavesSettings>(DEFAULT_GAME_SAVES_SETTINGS)
  const [settingsReady, setSettingsReady] = useState(false)
  const latestSettings = useRef(settings)
  latestSettings.current = settings
  const latestSnapshot = useRef(snapshot)
  latestSnapshot.current = snapshot
  /** 收到状态的本地时间，用于本地递减倒计时 */
  const [statusAt, setStatusAt] = useState(0)
  const [syncedRoom, setSyncedRoom] = useState<string | null>(null)
  const [error, setError] = useState('')
  const pending = useRef(new Map<string, { resolve: (reply: OkReply) => void; reject: (error: Error) => void; timer: number }>())
  const thumbs = useRef(new Map<string, Promise<string | null>>())

  useEffect(() => {
    return subscribeMessages((message) => {
      if (message.type === 'saves.status' && message.gameId === roomId) {
        setSnapshot((current) => (current ? { ...current, status: message.status } : current))
        setStatusAt(Date.now())
      }
      if (message.type === 'saves.changed' && message.gameId === roomId) {
        setSnapshot(message.snapshot)
        setStatusAt(Date.now())
      }
      if (message.type !== 'saves.reply') return
      const request = pending.current.get(message.reqId)
      if (!request) return
      window.clearTimeout(request.timer)
      pending.current.delete(message.reqId)
      if (message.ok) request.resolve(message)
      else request.reject(new GameSavesCommandError(message.error, message.code, message.reason))
    })
  }, [subscribeMessages, roomId])

  const command = useCallback(
    (op: GameSavesOp): Promise<OkReply> =>
      new Promise<OkReply>((resolve, reject) => {
        if (!connected || !roomId) return reject(new GameSavesCommandError(tNow('saves.error.connectFirst')))
        const reqId = crypto.randomUUID()
        const slow = op.op === 'save' || op.op === 'load' || op.op === 'clear'
        const timer = window.setTimeout(
          () => {
            pending.current.delete(reqId)
            reject(new GameSavesCommandError(tNow('saves.error.timeout')))
          },
          slow ? TIMEOUT_MS.slow : TIMEOUT_MS.quick
        )
        pending.current.set(reqId, {
          resolve: (reply) => {
            if (op.op !== 'thumb') {
              setSnapshot(reply.snapshot)
              setStatusAt(Date.now())
            }
            resolve(reply)
          },
          reject,
          timer,
        })
        try {
          send({ type: 'saves.cmd', reqId, gameId: roomId, ...op })
        } catch (cause) {
          window.clearTimeout(timer)
          pending.current.delete(reqId)
          reject(cause instanceof Error ? cause : new Error(String(cause)))
        }
      }),
    [connected, roomId, send]
  )

  useEffect(() => {
    setSnapshot(null)
    setSyncedRoom(null)
    setError('')
    thumbs.current.clear()
  }, [roomId])

  useEffect(() => {
    let cancelled = false
    setSettingsReady(false)
    readSettings(localGlobal)
      .then((stored) => {
        if (!cancelled) setSettings(stored)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setSettingsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [localGlobal])

  /** 游戏侧（另一端页面或游戏目录里的旧设置）版本更新时，采用并写回通用设置 */
  const remoteSettings = snapshot?.settings
  useEffect(() => {
    if (!settingsReady || !remoteSettings) return
    const current = latestSettings.current
    if (remoteSettings.revision <= current.revision) return
    latestSettings.current = remoteSettings
    setSettings(remoteSettings)
    void writeSettings(remoteSettings, current.revision, localGlobal).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [remoteSettings, settingsReady, localGlobal])

  useEffect(() => {
    if (!connected || !roomId || !settingsReady) return
    let cancelled = false
    void command({ op: 'snapshot' })
      .then(async (reply) => {
        const remote = reply.snapshot.settings
        const local = latestSettings.current
        if (!cancelled && local.revision > remote.revision) await command({ op: 'configure', settings: local, expectedRevision: remote.revision })
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setSyncedRoom(roomId)
      })
    return () => {
      cancelled = true
    }
  }, [connected, roomId, settingsReady, command])

  /** 先写通用设置，已连接时再下发给游戏 */
  const saveSettings = useCallback(
    async (patch: Partial<GameSavesSettings>) => {
      const base = latestSettings.current
      const remote = latestSnapshot.current?.settings
      const next = parseGameSavesSettings({ ...base, ...patch, revision: Math.max(base.revision, remote?.revision ?? 0) + 1 })
      await writeSettings(next, base.revision, localGlobal)
      latestSettings.current = next
      setSettings(next)
      if (!connected || !remote) return
      try {
        await command({ op: 'configure', settings: next, expectedRevision: remote.revision })
      } catch {
        // 下发前游戏侧版本已变（另一页面刚改过）：以游戏侧最新设置为底重放本次改动，版本号取更大者 +1，
        // 否则两端可能同一版本号不同内容，而远端同步只认更大的版本号，永远不会自愈
        const fresh = (await command({ op: 'snapshot' })).snapshot.settings
        const local = latestSettings.current
        const rebased = parseGameSavesSettings({ ...fresh, ...patch, revision: Math.max(fresh.revision, local.revision) + 1 })
        await writeSettings(rebased, local.revision, localGlobal)
        latestSettings.current = rebased
        setSettings(rebased)
        await command({ op: 'configure', settings: rebased, expectedRevision: fresh.revision })
      }
    },
    [localGlobal, connected, command]
  )

  /** 缩略图按条目与保存时间缓存，覆盖保存后自动换新 */
  const thumb = useCallback(
    (entry: GameSaveEntry): Promise<string | null> => {
      if (!entry.hasThumb) return Promise.resolve(null)
      const key = `${entry.id}@${entry.savedAt}`
      let cached = thumbs.current.get(key)
      if (!cached) {
        cached = command({ op: 'thumb', entryId: entry.id }).then(
          (reply) => reply.result ?? null,
          () => null
        )
        thumbs.current.set(key, cached)
      }
      return cached
    },
    [command]
  )

  const retry = useCallback(() => {
    setError('')
    void command({ op: 'snapshot' }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [command])

  const ready = !!snapshot && syncedRoom === roomId

  return { roomId, connected, negotiating, ready, snapshot, statusAt, error, setError, command, thumb, retry, settings, settingsReady, saveSettings }
}
