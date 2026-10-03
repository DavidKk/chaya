'use client'

import { LuBookOpen } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard, IntegrationField } from '@/components/integration/mcp/McpConnectionCard'
import { MCP_DOCS_URL, MCP_GATEWAY_DEFAULT_PORT, mcpPortConfigFile } from '@/lib/integration/mcp-port'

const CONFIG_FILES = [
  { platform: 'macOS', file: mcpPortConfigFile({ platform: 'darwin', home: '~' }) },
  { platform: 'Windows', file: mcpPortConfigFile({ platform: 'win32', home: '', appData: '%APPDATA%' }) },
  { platform: 'Linux', file: mcpPortConfigFile({ platform: 'linux', home: '~' }) },
]

const linkClass =
  'inline-flex h-8 w-max items-center gap-2 rounded-[0.3rem] border border-line bg-paper px-3 text-xs font-medium text-ink no-underline transition-colors hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Edge: static docs only — the page never probes the local gateway. */
export function McpEdgeGuide() {
  const t = useT()
  return (
    <section className={integrationCard} aria-label={t('mcpGateway.edgeTitle')}>
      <p className="m-0 text-[13px] font-semibold text-ink">{t('mcpGateway.edgeTitle')}</p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-xs leading-relaxed text-ink">
        <li>{t('mcpGateway.edgeStep1')}</li>
        <li>{t('mcpGateway.edgeStep2')}</li>
        <li>{t('mcpGateway.edgeStep3')}</li>
      </ol>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('mcpGateway.edgeDefaultPort', { port: MCP_GATEWAY_DEFAULT_PORT })}</p>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('mcpGateway.edgeToolsHint')}</p>
      <IntegrationField label={t('mcpGateway.configFiles')}>
        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {CONFIG_FILES.map(({ platform, file }) => (
            <div key={platform} className="contents">
              <dt className="text-ink-soft">{platform}</dt>
              <dd className="m-0 font-mono break-all text-ink">{file}</dd>
            </div>
          ))}
        </dl>
      </IntegrationField>
      <a className={linkClass} href={MCP_DOCS_URL} target="_blank" rel="noreferrer">
        <LuBookOpen size={14} aria-hidden />
        {t('mcpGateway.openDocs')}
      </a>
    </section>
  )
}
