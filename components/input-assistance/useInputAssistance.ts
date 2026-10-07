'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useGameToolTransport } from '@/components/game-tools/transport'
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, type InputChord, type MacroEvent, parseInputAssistConfig } from '@/lib/game/input-assistance'
import type { InputAssistMessage } from '@/lib/runtime/game-link-protocol'

type Reply = Extract<InputAssistMessage, { type: 'assist.reply' }>
type CommandPayload = InputAssistMessage extends infer Message ? (Message extends { type: 'assist.cmd' } ? Omit<Message, 'type' | 'reqId' | 'gameId'> : never) : never
type Status = NonNullable<Reply['status']>
const GLOBAL_KEY = 'chaya:input-assistance:global'

function emptyConfig(): InputAssistConfig {
  return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
}

function currentStatus(status: Status): Status {
  return { ...status, pending: status.pending ?? [] }
}

export function gameKey(roomId: string | null): string {
  return `chaya:input-assistance:game:${roomId || 'unselected'}`
}

export function readStored(key: string): InputAssistConfig {
  try {
    return parseInputAssistConfig(JSON.parse(localStorage.getItem(key) || 'null'))
  } catch {
    return emptyConfig()
  }
}

export async function loadGlobalConfig(localGlobal: boolean): Promise<InputAssistConfig> {
  if (localGlobal) return readStored(GLOBAL_KEY)
  const response = await fetch('/api/input-assistance/global')
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || '无法读取通用配置')
  return parseInputAssistConfig(body.config)
}

async function writeGlobal(next: InputAssistConfig, expectedRevision: number, localGlobal: boolean): Promise<void> {
  if (localGlobal) {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(next))
    return
  }
  const response = await fetch('/api/input-assistance/global', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: next, expectedRevision }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || '保存通用配置失败')
}

export function useInputAssistance() {
  const { roomId, localGlobal, connected, negotiating, restart, send, subscribeMessages } = useGameToolTransport()
  const [globalConfig, setGlobal] = useState<InputAssistConfig>(emptyConfig)
  const [gameConfig, setGame] = useState<InputAssistConfig>(emptyConfig)
  const [status, setStatus] = useState<Status>({ running: [], pending: [], counts: {}, recording: false })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [globalReady, setGlobalReady] = useState(false)
  /** 已完成首次快照的游戏；之后保存触发的重新快照不再算“首次读取” */
  const [syncedRoom, setSyncedRoom] = useState<string | null>(null)
  const pending = useRef(new Map<string, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: number }>())
  const recording = useRef<((result: InputChord | MacroEvent[] | null) => void) | null>(null)
  /** 同一次操作里连续保存两个范围时，后一次必须带上前一次刚保存的配置，不能用渲染闭包里的旧值 */
  const latest = useRef({ global: globalConfig, game: gameConfig })
  latest.current = { global: globalConfig, game: gameConfig }

  /** 另一端（Web 控制台 / 局内浮层）改过配置时，采用版本更新的一份并落到本端存储 */
  const adopt = useCallback(
    async (remoteGlobal: InputAssistConfig, remoteGame: InputAssistConfig) => {
      const current = latest.current
      if (remoteGlobal.revision > current.global.revision) {
        await writeGlobal(remoteGlobal, current.global.revision, localGlobal)
        latest.current = { ...latest.current, global: remoteGlobal }
        setGlobal(remoteGlobal)
      }
      if (remoteGame.revision > current.game.revision) {
        localStorage.setItem(gameKey(roomId), JSON.stringify(remoteGame))
        latest.current = { ...latest.current, game: remoteGame }
        setGame(remoteGame)
      }
    },
    [localGlobal, roomId]
  )

  useEffect(() => {
    return subscribeMessages((message) => {
      if (message.type === 'assist.status') setStatus(currentStatus(message.status))
      if (message.type === 'assist.config') void adopt(message.globalConfig, message.gameConfig).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      if (message.type === 'assist.recorded') {
        recording.current?.(message.result)
        recording.current = null
      }
      if (message.type !== 'assist.reply') return
      const request = pending.current.get(message.reqId)
      if (!request) return
      window.clearTimeout(request.timer)
      pending.current.delete(message.reqId)
      if (message.ok) request.resolve(message)
      else request.reject(new Error(message.error || '游戏未执行辅助命令'))
    })
  }, [subscribeMessages, adopt])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const config = await loadGlobalConfig(localGlobal)
        if (!cancelled) setGlobal(config)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setGlobalReady(true)
      }
    }
    setGlobalReady(false)
    void load()
    return () => {
      cancelled = true
    }
  }, [localGlobal])

  useEffect(() => {
    setGame(readStored(gameKey(roomId)))
  }, [roomId])

  const command = useCallback(
    (payload: CommandPayload) => {
      return new Promise<Reply>((resolve, reject) => {
        if (!connected || !roomId) return reject(new Error('请先连接游戏'))
        const reqId = crypto.randomUUID()
        const timer = window.setTimeout(() => {
          pending.current.delete(reqId)
          reject(new Error('游戏响应超时'))
        }, 10_000)
        pending.current.set(reqId, { resolve, reject, timer })
        try {
          send({ type: 'assist.cmd', reqId, gameId: roomId, ...payload } as InputAssistMessage)
        } catch (error) {
          window.clearTimeout(timer)
          pending.current.delete(reqId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    [connected, roomId, send]
  )

  useEffect(() => {
    if (!connected) {
      setStatus({ running: [], pending: [], counts: {}, recording: false })
      recording.current?.(null)
      recording.current = null
      return
    }
    if (!globalReady) return
    let cancelled = false
    setLoading(true)
    void command({ op: 'snapshot' })
      .then(async (reply) => {
        if (cancelled) return
        const remoteGlobal = reply.globalConfig ?? emptyConfig()
        const remoteGame = reply.gameConfig ?? emptyConfig()
        latest.current = { ...latest.current, game: readStored(gameKey(roomId)) }
        await adopt(remoteGlobal, remoteGame)
        const chosen = latest.current
        setGame(chosen.game)
        if (chosen.global.revision > remoteGlobal.revision || chosen.game.revision > remoteGame.revision)
          await command({ op: 'configure', globalConfig: chosen.global, gameConfig: chosen.game })
        if (reply.status) setStatus(currentStatus(reply.status))
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setSyncedRoom(roomId)
      })
    return () => {
      cancelled = true
    }
  }, [connected, roomId, command, globalReady, adopt])

  const save = useCallback(
    async (scope: 'global' | 'game', next: InputAssistConfig) => {
      if (scope === 'global') {
        await writeGlobal(next, latest.current.global.revision, localGlobal)
        latest.current = { ...latest.current, global: next }
        setGlobal(next)
      } else {
        localStorage.setItem(gameKey(roomId), JSON.stringify(next))
        latest.current = { ...latest.current, game: next }
        setGame(next)
      }
      if (connected) await command({ op: 'configure', globalConfig: latest.current.global, gameConfig: latest.current.game })
      setError('')
    },
    [localGlobal, command, connected, roomId]
  )

  const control = useCallback(
    async (op: 'start' | 'stop' | 'stopAll' | 'test', ruleId?: string) => {
      try {
        const reply = await command(op === 'stopAll' ? { op } : { op, ruleId: ruleId! })
        if (reply.status) setStatus(currentStatus(reply.status))
        setError('')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [command]
  )

  const record = useCallback(
    async (kind: 'binding' | 'macro'): Promise<InputChord | MacroEvent[] | null> => {
      if (recording.current) throw new Error('已有录制正在进行')
      const result = new Promise<InputChord | MacroEvent[] | null>((resolve) => {
        recording.current = resolve
      })
      try {
        await command({ op: 'recordStart', kind })
        return await result
      } catch (error) {
        recording.current = null
        throw error
      }
    },
    [command]
  )

  const ready = globalReady && (!connected || syncedRoom === roomId)

  return { roomId, connected, negotiating, restart, loading, globalReady, ready, error, setError, globalConfig, gameConfig, status, save, control, record, command }
}
