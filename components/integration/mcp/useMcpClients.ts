'use client'

import { useCallback, useEffect, useState } from 'react'

import { readApiErrorMessage } from '@/lib/api-error'
import type { McpCliClientId, McpClientsStatus } from '@/services/integration/mcp-clients'

const API = '/api/integration/mcp/clients'

export type McpClientAction = 'install' | 'uninstall'

/** Local server only: Claude Code / Codex install state; refreshes on window focus */
export function useMcpClients() {
  const [clients, setClients] = useState<McpClientsStatus | null>(null)
  const [busy, setBusy] = useState<McpCliClientId | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { clients?: McpClientsStatus } | null
      if (res.ok && data?.clients) setClients(data.clients)
    } catch {
      /* keep the last known status */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  /** Resolves to an error message, or `null` on success */
  const run = useCallback(async (client: McpCliClientId, action: McpClientAction): Promise<string | null> => {
    setBusy(client)
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client, action }) })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) return readApiErrorMessage(data, `HTTP ${res.status}`)
      setClients((data as { clients: McpClientsStatus }).clients)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    } finally {
      setBusy(null)
    }
  }, [])

  return { clients, busy, run }
}
