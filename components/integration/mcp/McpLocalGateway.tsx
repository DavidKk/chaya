'use client'

import { useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { McpGatewayCard, type McpGatewayView } from '@/components/integration/mcp/McpGatewayCard'
import { readApiErrorMessage } from '@/lib/api-error'
import { MCP_DOCS_URL } from '@/lib/integration/mcp-port'

const API = '/api/integration/mcp'

async function call(method: 'PUT' | 'DELETE' | 'POST', body?: unknown): Promise<McpGatewayView | null> {
  const res = await fetch(API, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as { gateway?: McpGatewayView } | null
  if (!res.ok) throw new Error(readApiErrorMessage(data, `HTTP ${res.status}`))
  return data?.gateway ?? null
}

/** Local service: gateway status and port management, so App-only users need not open a game. */
export function McpLocalGateway({ initial, onChange }: { initial: McpGatewayView; onChange: () => void }) {
  const t = useT()
  const [view, setView] = useState(initial)
  const apply = async (next: Promise<McpGatewayView | null>) => {
    const value = await next
    if (value) setView(value)
    onChange()
    return value
  }

  return (
    <section className={integrationCard} aria-label={t('mcpGateway.regionAria')}>
      <p className="m-0 text-[13px] font-semibold text-ink">{t('mcpGateway.title')}</p>
      <McpGatewayCard
        context="server"
        view={view}
        connectionFields={false}
        onSavePort={(port) => apply(call('PUT', { port }))}
        onDelete={() => apply(call('DELETE'))}
        onOpenFolder={() => void call('POST').catch(() => undefined)}
        onOpenDocs={() => window.open(MCP_DOCS_URL, '_blank', 'noopener')}
      />
    </section>
  )
}
