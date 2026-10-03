'use client'

import { useCallback, useEffect, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { McpGatewayCard, type McpGatewayView } from '@/components/integration/mcp/McpGatewayCard'
import { ScrollArea } from '@/components/sk'
import type { McpGatewayControl, McpGatewayStatus } from '@/lib/integration/mcp-gateway'
import { MCP_DOCS_URL } from '@/lib/integration/mcp-port'

const REFRESH_MS = 3_000

function gatewayControl(): McpGatewayControl | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { ChayaAgent?: { gateway?: McpGatewayControl } }).ChayaAgent?.gateway
}

function toView(status: McpGatewayStatus | null | undefined): McpGatewayView | null {
  if (!status) return null
  const { state, port, url, file, fileExists, holder, lastRequestAt } = status
  return { state, port, url, file, fileExists, holderRole: holder?.role, lastRequestAt }
}

/** In-game「MCP」page: ChayaAgent owns the gateway; this pane only reads and drives `window.ChayaAgent.gateway`. */
export function GameEditMcpPane() {
  const t = useT()
  const [view, setView] = useState<McpGatewayView | null>(() => toView(gatewayControl()?.status()))
  const control = gatewayControl()

  const refresh = useCallback(async () => {
    const next = await gatewayControl()
      ?.refresh()
      .catch(() => null)
    setView(toView(next))
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const apply = async (action: (gateway: McpGatewayControl) => Promise<McpGatewayStatus>) => {
    const gateway = gatewayControl()
    if (!gateway) return null
    const next = toView(await action(gateway))
    setView(next)
    return next
  }

  return (
    <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('mcpGateway.regionAria') }}>
      <div className="flex max-w-2xl flex-col gap-3 p-4">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t('mcpGateway.title')}</h2>
        <McpGatewayCard
          context="game"
          view={view}
          available={!!control?.available}
          onSavePort={(port) => apply((gateway) => gateway.setPort(port))}
          onDelete={() => apply((gateway) => gateway.resetPort())}
          onOpenFolder={control ? () => control.openFolder() : undefined}
          onOpenDocs={() => (control ? control.openDocs() : window.open(MCP_DOCS_URL, '_blank', 'noopener'))}
        />
      </div>
    </ScrollArea>
  )
}
