'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { McpGatewayCard, type McpGatewayView } from '@/components/integration/mcp/McpGatewayCard'
import type { McpRpc } from '@/components/integration/mcp/McpPlayground'
import { McpView } from '@/components/integration/mcp/McpView'
import { panelBody } from '@/components/layoutClasses'
import type { McpGatewayControl, McpGatewayStatus } from '@/lib/integration/mcp-gateway'
import { MCP_DOCS_URL } from '@/lib/integration/mcp-port'
import { cn } from '@/lib/utils'

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

const gatewayRpc: McpRpc = async (body) => {
  const gateway = gatewayControl()
  if (!gateway) return { status: 503, body: { error: 'ChayaAgent 未就绪：请确认已安装 Agent 插件' } }
  return gateway.rpc(body)
}

function GatewayOverview() {
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
    <section className={integrationCard}>
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
    </section>
  )
}

/** In-game「集成」page: the MCP view scoped to this game (ChayaAgent owns the gateway); no WebMCP in the game window. */
export function GameEditMcpPane() {
  const t = useT()
  const game = useMemo(() => ({ overview: <GatewayOverview />, rpc: gatewayRpc }), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper" role="region" aria-label={t('mcpGateway.regionAria')}>
      <div className={cn(panelBody, 'overflow-hidden')}>
        <McpView game={game} />
      </div>
    </div>
  )
}
