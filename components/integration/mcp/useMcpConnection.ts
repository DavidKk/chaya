'use client'

import { useCallback, useEffect, useState } from 'react'

import { readApiErrorMessage } from '@/lib/api-error'
import type { ServiceMode } from '@/lib/service-mode/mode'

export type McpConnection = { available: false; serviceMode: ServiceMode } | { available: true; serviceMode: ServiceMode; endpoint: string; evalEnabled: boolean }

export type McpConnectionState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; connection: McpConnection }

export function useMcpConnection(): McpConnectionState & { reload: () => void } {
  const [state, setState] = useState<McpConnectionState>({ status: 'loading' })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/integration/mcp', { cache: 'no-store', signal: controller.signal })
        const data: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          setState({ status: 'error', message: readApiErrorMessage(data, `HTTP ${res.status}`) })
          return
        }
        setState({ status: 'ready', connection: data as McpConnection })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => controller.abort()
  }, [version])

  return { ...state, reload }
}
