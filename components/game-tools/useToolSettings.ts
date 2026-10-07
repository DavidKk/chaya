'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import {
  cacheToolSettings,
  DEFAULT_TOOL_SETTINGS,
  normalizeToolSettings,
  readCachedToolSettings,
  TOOL_SETTINGS_EVENT,
  TOOL_SETTINGS_STORAGE_KEY,
  type ToolSettings,
} from '@/lib/game-agent/tool-settings'

const API = '/api/integration/game-agent/tools'
const browserRequest: GameAgentRequest = (path, init) => fetch(path, init)

/** 保存按顺序执行：每次执行时才读缓存，连点时后一次带上前一次的结果（两个 React 根共用） */
let saving: Promise<unknown> = Promise.resolve()
/** 读取期间有保存开始或仍在排队时丢弃读取结果，避免旧值覆盖刚保存的缓存 */
let savesStarted = 0
let savesActive = 0

/** 函数形式在轮到执行时才基于最新设置计算，用于依赖当前值的改动 */
export type ToolSettingsPatch = Partial<ToolSettings> | ((current: ToolSettings) => Partial<ToolSettings>)

/** 整份 PUT：先取服务端最新值再合并，避免另一个窗口（Web 页 / 游戏内）的旧缓存把对方的改动写回去 */
async function readLatest(request: GameAgentRequest): Promise<ToolSettings> {
  try {
    const response = await request(API, { cache: 'no-store' })
    if (response.ok) {
      const body = (await response.json()) as { settings?: unknown }
      cacheToolSettings(normalizeToolSettings(body.settings))
    }
  } catch {
    // 读不到时按本地缓存合并，保存结果仍以 PUT 为准
  }
  return readCachedToolSettings()
}

export function useToolSettings(request: GameAgentRequest = browserRequest, refreshMs?: number) {
  const [settings, setSettings] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(0)

  useEffect(() => {
    const onChange = () => setSettings(readCachedToolSettings())
    window.addEventListener(TOOL_SETTINGS_EVENT, onChange)
    onChange()
    const refresh = () => {
      const startedAt = savesStarted
      void Promise.resolve()
        .then(() => request(API, { cache: 'no-store' }))
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = (await response.json()) as { settings?: unknown }
          if (savesStarted === startedAt && !savesActive) cacheToolSettings(normalizeToolSettings(body.settings))
          setError('')
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setLoaded(true))
    }
    refresh()
    const timer = refreshMs ? window.setInterval(refresh, refreshMs) : null
    // 另一端（游戏内浮层 / 其他标签页）改了设置：切回本页时重新拉取，同源标签页经 storage 事件即时同步
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === TOOL_SETTINGS_STORAGE_KEY) onChange()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(TOOL_SETTINGS_EVENT, onChange)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('storage', onStorage)
      if (timer != null) window.clearInterval(timer)
    }
  }, [request, refreshMs])

  const update = useCallback(
    (patch: ToolSettingsPatch) => {
      pending.current += 1
      savesStarted += 1
      savesActive += 1
      setBusy(true)
      setError('')
      const run = saving.then(async () => {
        try {
          const current = await readLatest(request)
          const next = normalizeToolSettings({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) })
          const response = await request(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: next }) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = (await response.json()) as { settings?: unknown }
          cacheToolSettings(normalizeToolSettings(body.settings))
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          pending.current -= 1
          savesActive -= 1
          setBusy(pending.current > 0)
        }
      })
      saving = run
      return run
    },
    [request]
  )

  /** 非本机模式：接口不存在。一次保存或轮询失败不算 */
  const unavailable = loaded && error === 'HTTP 404'
  return { settings, busy, loaded, error, unavailable, update }
}
