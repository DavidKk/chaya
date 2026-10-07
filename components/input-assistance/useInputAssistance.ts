'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, type InputChord, type MacroEvent, parseInputAssistConfig } from '@/lib/game/input-assistance'
import type { InputAssistMessage } from '@/lib/runtime/game-link-protocol'

type Reply = Extract<InputAssistMessage, { type: 'assist.reply' }>
type CommandPayload = InputAssistMessage extends infer Message ? (Message extends { type: 'assist.cmd' } ? Omit<Message, 'type' | 'reqId' | 'gameId'> : never) : never
type Status = NonNullable<Reply['status']>
const GLOBAL_KEY = 'chaya:input-assistance:global'

function currentStatus(status: Status): Status {
  return { ...status, pending: status.pending ?? [] }
}

function readGlobal(): InputAssistConfig {
  try {
    return parseInputAssistConfig(JSON.parse(localStorage.getItem(GLOBAL_KEY) || 'null'))
  } catch {
    return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
  }
}

export function useInputAssistance() {
  const { roomId, browserMode, connected, negotiating, restart, send, subscribeMessages } = useGameLinkContext()
  const [globalConfig, setGlobal] = useState<InputAssistConfig>({ ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] })
  const [gameConfig, setGame] = useState<InputAssistConfig>({ ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] })
  const [status, setStatus] = useState<Status>({ running: [], pending: [], counts: {}, recording: false })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [globalReady, setGlobalReady] = useState(false)
  /** 已完成首次快照的游戏；之后保存触发的重新快照不再算“首次读取” */
  const [syncedRoom, setSyncedRoom] = useState<string | null>(null)
  const pending = useRef(new Map<string, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: number }>())
  const recording = useRef<((result: InputChord | MacroEvent[] | null) => void) | null>(null)

  useEffect(() => {
    return subscribeMessages((message) => {
      if (message.type === 'assist.status') setStatus(currentStatus(message.status))
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
  }, [subscribeMessages])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (browserMode) {
          if (!cancelled) setGlobal(readGlobal())
          return
        }
        const response = await fetch('/api/input-assistance/global')
        const body = await response.json()
        if (!response.ok) throw new Error(body.error?.message || '无法读取通用配置')
        if (!cancelled) setGlobal(parseInputAssistConfig(body.config))
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
  }, [browserMode])

  useEffect(() => {
    try {
      setGame(parseInputAssistConfig(JSON.parse(localStorage.getItem(`chaya:input-assistance:game:${roomId || 'unselected'}`) || 'null')))
    } catch {
      setGame({ ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] })
    }
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
        const remoteGlobal = reply.globalConfig ?? { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
        const chosenGlobal = globalConfig
        if (remoteGlobal.revision > chosenGlobal.revision) throw new Error('游戏中的通用配置比本机配置更新，请先核对配置来源')
        let cachedGame: InputAssistConfig
        try {
          cachedGame = parseInputAssistConfig(JSON.parse(localStorage.getItem(`chaya:input-assistance:game:${roomId || 'unselected'}`) || 'null'))
        } catch {
          cachedGame = { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
        }
        const remoteGame = reply.gameConfig ?? { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
        const chosenGame = cachedGame.revision > remoteGame.revision ? cachedGame : remoteGame
        setGlobal(chosenGlobal)
        setGame(chosenGame)
        if (browserMode) localStorage.setItem(GLOBAL_KEY, JSON.stringify(chosenGlobal))
        localStorage.setItem(`chaya:input-assistance:game:${roomId || 'unselected'}`, JSON.stringify(chosenGame))
        if (chosenGlobal.revision > remoteGlobal.revision || chosenGame.revision > remoteGame.revision)
          await command({ op: 'configure', globalConfig: chosenGlobal, gameConfig: chosenGame })
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
  }, [connected, roomId, command, globalReady, globalConfig, browserMode])

  /** 同一次操作里连续保存两个范围时，后一次必须带上前一次刚保存的配置，不能用渲染闭包里的旧值 */
  const latest = useRef({ global: globalConfig, game: gameConfig })
  latest.current = { global: globalConfig, game: gameConfig }

  const save = useCallback(
    async (scope: 'global' | 'game', next: InputAssistConfig) => {
      if (scope === 'global' && !browserMode) {
        const response = await fetch('/api/input-assistance/global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: next, expectedRevision: latest.current.global.revision }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error?.message || '保存通用配置失败')
      }
      if (scope === 'global') {
        if (browserMode) localStorage.setItem(GLOBAL_KEY, JSON.stringify(next))
        latest.current = { ...latest.current, global: next }
        setGlobal(next)
      } else {
        localStorage.setItem(`chaya:input-assistance:game:${roomId || 'unselected'}`, JSON.stringify(next))
        latest.current = { ...latest.current, game: next }
        setGame(next)
      }
      if (connected) await command({ op: 'configure', globalConfig: latest.current.global, gameConfig: latest.current.game })
      setError('')
    },
    [browserMode, command, connected, roomId]
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
