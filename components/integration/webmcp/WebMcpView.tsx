'use client'

import { useEffect, useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { Badge, ScrollArea } from '@/components/sk'
import { MCP_REGISTRAR_ID, PLUGINS_REGISTRAR_ID } from '@/components/webmcp/ChayaWebMcpHost'
import { EDIT_REGISTRAR_ID } from '@/components/webmcp/edit-tools'
import { PAGE_REGISTRAR_ID } from '@/components/webmcp/page/tools'
import { getWebMcpSupportReport, type WebMcpSupportReport } from '@/initializer/webmcp/model-context'
import { listRegisteredPageTools, type RegisteredPageTool, subscribeRegisteredPageTools } from '@/initializer/webmcp/register-page-tools'
import type { MessageKey } from '@/lib/i18n'

const GROUPS = [
  { id: PAGE_REGISTRAR_ID, labelKey: 'integration.webmcpGroupPage' },
  { id: MCP_REGISTRAR_ID, labelKey: 'integration.webmcpGroupMcp' },
  { id: EDIT_REGISTRAR_ID, labelKey: 'integration.webmcpGroupEdit' },
  { id: PLUGINS_REGISTRAR_ID, labelKey: 'integration.webmcpGroupPlugins' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>

const STEP_KEYS = ['integration.webmcpStep1', 'integration.webmcpStep2', 'integration.webmcpStep3'] as const satisfies ReadonlyArray<MessageKey>
const MODE_KEYS = ['integration.webmcpModeLocal', 'integration.webmcpModeEdge', 'integration.webmcpModeLocked'] as const satisfies ReadonlyArray<MessageKey>

function useRegisteredTools(): RegisteredPageTool[] {
  const [tools, setTools] = useState<RegisteredPageTool[]>([])
  useEffect(() => {
    const read = () => setTools(listRegisteredPageTools())
    read()
    return subscribeRegisteredPageTools(read)
  }, [])
  return tools
}

function ToolRow({ tool }: { tool: RegisteredPageTool }) {
  const t = useT()
  const hints = tool.annotations
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="font-mono text-[13px] text-ink">{tool.name}</code>
        {hints?.readOnlyHint ? <Badge tone="ok">{t('integration.webmcpReadOnly')}</Badge> : null}
        {hints?.consequentialHint ? <Badge tone="warn">{t('integration.webmcpConsequential')}</Badge> : null}
        {hints?.untrustedContentHint ? <Badge tone="neutral">{t('integration.webmcpUntrusted')}</Badge> : null}
      </div>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">{tool.description}</p>
    </li>
  )
}

/** WebMCP 子页：浏览器支持状态 + 启用步骤 + 本页实时已注册工具 */
export function WebMcpView() {
  const t = useT()
  const [report, setReport] = useState<WebMcpSupportReport | null>(null)
  const tools = useRegisteredTools()
  const contentNote = t('integration.mcpContentNote')

  useEffect(() => setReport(getWebMcpSupportReport()), [])

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, tools: tools.filter((tool) => tool.registrarId === group.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter(
        (group) => group.tools.length > 0
      ),
    [tools]
  )

  return (
    <ScrollArea className="h-full min-h-0" indicator="vertical">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-5">
        <p className="m-0 text-[13px] leading-relaxed text-ink">{t('integration.webmcpIntro')}</p>

        {report ? (
          <div className={integrationCard} role="status">
            {report.supported ? (
              <p className="m-0 text-[13px] font-semibold text-ok">{t('integration.webmcpSupported')}</p>
            ) : (
              <>
                <p className="m-0 text-[13px] font-semibold text-ink">{t('integration.webmcpUnsupported')}</p>
                {report.reason === 'no_secure_context' ? <p className="m-0 text-xs text-ink-soft">{t('integration.webmcpNeedSecure')}</p> : null}
              </>
            )}
          </div>
        ) : null}

        <section className={integrationCard} aria-labelledby="webmcp-steps-title">
          <h2 id="webmcp-steps-title" className="m-0 text-sm font-semibold text-ink">
            {t('integration.webmcpStepsTitle')}
          </h2>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-xs leading-relaxed text-ink-soft">
            {STEP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </section>

        <section className={integrationCard} aria-labelledby="webmcp-modes-title">
          <h2 id="webmcp-modes-title" className="m-0 text-sm font-semibold text-ink">
            {t('integration.webmcpModesTitle')}
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-ink-soft">
            {MODE_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="webmcp-tools-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="webmcp-tools-title" className="m-0 text-base font-semibold text-ink">
              {t('integration.webmcpRegistered')}
            </h2>
            <span className="text-xs text-ink-soft">{t('integration.toolCount', { count: tools.length })}</span>
          </div>
          {contentNote ? <p className="m-0 text-xs text-ink-soft">{contentNote}</p> : null}
          {groups.length === 0 ? <p className="m-0 text-xs text-ink-soft">{t('integration.webmcpEmpty')}</p> : null}
          {groups.map((group) => (
            <div key={group.id} className={integrationCard}>
              <h3 className="m-0 flex items-baseline gap-2 text-sm font-semibold text-ink">
                {t(group.labelKey)}
                <span className="font-mono text-[11px] font-normal text-ink-soft">{group.tools.length}</span>
              </h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {group.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </ScrollArea>
  )
}
