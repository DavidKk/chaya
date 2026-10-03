'use client'

import { useMemo } from 'react'
import { LuExternalLink, LuShieldCheck } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { hubBlock } from '@/components/integration/Hub'
import { Badge, CopyField } from '@/components/sk'
import { MCP_SERVER_NAME } from '@/lib/integration/mcp-catalog'
import { claudeCodeInstallCommand, codexInstallCommand, cursorInstallLink, mcpJsonConfig, vscodeInstallLink } from '@/lib/integration/mcp-install'
import { cn } from '@/lib/utils'

export const integrationCard = cn(hubBlock, 'gap-3')

const linkClass =
  'inline-flex h-8 items-center gap-2 rounded-[0.3rem] border border-line bg-paper px-3 text-xs font-medium text-ink no-underline transition-colors hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function IntegrationField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </div>
  )
}

type Props = {
  /** Unified gateway address */
  url: string
  /** Local only: direct `/api/mcp` address */
  compatEndpoint?: string
  /** Local only: `chaya_live_eval` switch */
  evalEnabled?: boolean
}

/** Unified address / no-auth note / one-click install / CLI commands / mcp.json */
export function McpConnectionCard({ url, compatEndpoint, evalEnabled }: Props) {
  const t = useT()
  const install = useMemo(() => ({ name: MCP_SERVER_NAME, url }), [url])

  return (
    <section className={integrationCard} aria-label={t('integration.connectionAria')}>
      <IntegrationField label={t('integration.endpoint')}>
        <CopyField value={url} label={t('integration.endpoint')} />
      </IntegrationField>
      <p className="m-0 inline-flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
        <LuShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        {t('integration.localHint')}
      </p>
      <IntegrationField label={t('integration.installLinks')}>
        <div className="flex flex-wrap gap-2">
          <a className={linkClass} href={cursorInstallLink(install)}>
            Cursor
            <LuExternalLink aria-hidden className="size-3.5" />
          </a>
          <a className={linkClass} href={vscodeInstallLink(install)}>
            VS Code
            <LuExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      </IntegrationField>
      <IntegrationField label={t('integration.claudeCode')}>
        <CopyField value={claudeCodeInstallCommand(install)} label={t('integration.claudeCode')} />
      </IntegrationField>
      <IntegrationField label={t('integration.codex')}>
        <CopyField value={codexInstallCommand(install)} label={t('integration.codex')} />
      </IntegrationField>
      <IntegrationField label={t('integration.configJson')}>
        <CopyField value={JSON.stringify(mcpJsonConfig(install), null, 2)} label={t('integration.configJson')} />
      </IntegrationField>
      {compatEndpoint ? (
        <IntegrationField label={t('mcpGateway.compatEndpoint')}>
          <CopyField value={compatEndpoint} label={t('mcpGateway.compatEndpoint')} />
        </IntegrationField>
      ) : null}
      {evalEnabled !== undefined ? (
        <div>
          <Badge tone={evalEnabled ? 'warn' : 'neutral'}>{evalEnabled ? t('integration.evalOn') : t('integration.evalOff')}</Badge>
        </div>
      ) : null}
    </section>
  )
}
