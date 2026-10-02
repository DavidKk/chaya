'use client'

import { useMemo } from 'react'
import { LuExternalLink } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import type { McpConnection } from '@/components/integration/mcp/useMcpConnection'
import { Badge, CopyField } from '@/components/sk'
import { MCP_SERVER_NAME } from '@/lib/integration/mcp-catalog'
import { claudeCodeInstallCommand, codexInstallCommand, cursorInstallLink, mcpJsonConfig, vscodeInstallLink } from '@/lib/integration/mcp-install'

export const integrationCard = 'flex flex-col gap-3 rounded-[0.35rem] border border-line bg-panel px-4 py-3'

const linkClass =
  'inline-flex h-8 items-center gap-1.5 rounded-[0.3rem] border border-line bg-paper-2 px-3 text-xs font-medium text-ink no-underline transition-colors hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </div>
  )
}

/** 本机可用时：地址 / 令牌 / mcp.json / 一键安装 / CLI 命令 */
export function McpConnectionCard({ connection }: { connection: Extract<McpConnection, { available: true }> }) {
  const t = useT()
  const install = useMemo(() => ({ name: MCP_SERVER_NAME, url: connection.endpoint, token: connection.token }), [connection])

  return (
    <section className={integrationCard} aria-label={t('integration.connectionAria')} data-webmcp-sensitive={connection.token ? '' : undefined}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('integration.endpoint')}>
          <CopyField value={connection.endpoint} label={t('integration.endpoint')} />
        </Field>
        {connection.token ? (
          <Field label={t('integration.token')}>
            <CopyField value={connection.token} label={t('integration.token')} />
          </Field>
        ) : null}
      </div>
      {connection.token ? <p className="m-0 text-xs text-warn">{t('integration.tokenHint')}</p> : null}
      <Field label={t('integration.installLinks')}>
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
      </Field>
      <Field label={t('integration.claudeCode')}>
        <CopyField value={claudeCodeInstallCommand(install)} label={t('integration.claudeCode')} />
      </Field>
      <Field label={t('integration.codex')}>
        <CopyField value={codexInstallCommand(install)} label={t('integration.codex')} />
        {connection.token ? <p className="m-0 text-xs text-ink-soft">{t('integration.codexHint')}</p> : null}
      </Field>
      <Field label={t('integration.configJson')}>
        <CopyField value={JSON.stringify(mcpJsonConfig(install), null, 2)} label={t('integration.configJson')} />
      </Field>
      <div>
        <Badge tone={connection.evalEnabled ? 'warn' : 'neutral'}>{connection.evalEnabled ? t('integration.evalOn') : t('integration.evalOff')}</Badge>
      </div>
    </section>
  )
}
