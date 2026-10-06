'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { cacheToolSettings, DEFAULT_TOOL_SETTINGS, normalizeToolSettings, readCachedToolSettings, TOOL_SETTINGS_EVENT, type ToolSettings } from '@/lib/game-agent/tool-settings'

const API = '/api/integration/game-agent/tools'
const browserRequest: GameAgentRequest = (path, init) => fetch(path, init)

export function useToolSettings(request: GameAgentRequest = browserRequest, refreshMs?: number) {
  const [settings, setSettings] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onChange = () => setSettings(readCachedToolSettings())
    window.addEventListener(TOOL_SETTINGS_EVENT, onChange)
    onChange()
    const refresh = () =>
      void request(API, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = (await response.json()) as { settings?: unknown }
          cacheToolSettings(normalizeToolSettings(body.settings))
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    refresh()
    const timer = refreshMs ? window.setInterval(refresh, refreshMs) : null
    return () => {
      window.removeEventListener(TOOL_SETTINGS_EVENT, onChange)
      if (timer != null) window.clearInterval(timer)
    }
  }, [request, refreshMs])

  const update = useCallback(
    async (patch: Partial<ToolSettings>) => {
      setBusy(true)
      setError('')
      try {
        const next = normalizeToolSettings({ ...readCachedToolSettings(), ...patch })
        const response = await request(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: next }) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = (await response.json()) as { settings?: unknown }
        cacheToolSettings(normalizeToolSettings(body.settings))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
      }
    },
    [request]
  )

  return { settings, busy, error, update }
}
