'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { hubBlock } from '@/components/integration/Hub'
import { McpClientInstall } from '@/components/integration/mcp/McpClientInstall'
import { Badge, CopyField } from '@/components/sk'
import { MCP_SERVER_NAME } from '@/lib/integration/mcp-catalog'
import { mcpJsonConfig } from '@/lib/integration/mcp-install'
import { cn } from '@/lib/utils'

export const integrationCard = cn(hubBlock, 'gap-3')

export function IntegrationField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </div>
  )
}

type Props = {
  url: string
  /** Server only: `chaya_live_eval` switch */
  evalEnabled?: boolean
}

/** Address / per-client install */
export function McpConnectionCard({ url, evalEnabled }: Props) {
  const t = useT()
  const endpointLabel = t('integration.serverEndpoint')

  return (
    <section className={integrationCard} aria-label={t('integration.connectionAria')}>
      <IntegrationField label={endpointLabel}>
        <CopyField value={url} label={endpointLabel} />
      </IntegrationField>
      <IntegrationField label={t('integration.installLinks')}>
        <McpClientInstall url={url} />
        <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('integration.clientIdleHint')}</p>
      </IntegrationField>
      <IntegrationField label={t('integration.configJson')}>
        <CopyField value={JSON.stringify(mcpJsonConfig({ name: MCP_SERVER_NAME, url }), null, 2)} label={t('integration.configJson')} />
      </IntegrationField>
      {evalEnabled !== undefined ? (
        <div>
          <Badge tone={evalEnabled ? 'warn' : 'neutral'}>{evalEnabled ? t('integration.evalOn') : t('integration.evalOff')}</Badge>
        </div>
      ) : null}
    </section>
  )
}
