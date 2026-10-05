'use client'

import { useEffect, useMemo, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuGlobe, LuMousePointerClick, LuPlug, LuPuzzle } from 'react-icons/lu'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { hubBlock, HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { useMcpConnection } from '@/components/integration/mcp/useMcpConnection'
import { Badge } from '@/components/sk'
import { getWebMcpSupportReport, type WebMcpSupportReport } from '@/initializer/webmcp/model-context'
import { listRegisteredPageTools, type RegisteredPageTool, subscribeRegisteredPageTools } from '@/initializer/webmcp/register-page-tools'
import type { MessageKey } from '@/lib/i18n'
import { localizedToolDescription } from '@/lib/integration/mcp-catalog-i18n'
import { cn } from '@/lib/utils'
import { MCP_REGISTRAR_ID, PAGE_REGISTRAR_ID, PLUGINS_REGISTRAR_ID } from '@/lib/webmcp/registrars'

const GROUPS = [
  { id: PAGE_REGISTRAR_ID, labelKey: 'integration.webmcpGroupPage', icon: LuMousePointerClick },
  { id: MCP_REGISTRAR_ID, labelKey: 'integration.webmcpGroupMcp', icon: LuPlug },
  { id: PLUGINS_REGISTRAR_ID, labelKey: 'integration.webmcpGroupPlugins', icon: LuPuzzle },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: IconType }>

const STEP_KEYS = ['integration.webmcpStep1', 'integration.webmcpStep2', 'integration.webmcpStep3'] as const satisfies ReadonlyArray<MessageKey>

function useRegisteredTools(): RegisteredPageTool[] {
  const [tools, setTools] = useState<RegisteredPageTool[]>([])
  useEffect(() => {
    const read = () => setTools(listRegisteredPageTools())
    read()
    return subscribeRegisteredPageTools(read)
  }, [])
  return tools
}

function ToolBlock({ tool }: { tool: RegisteredPageTool }) {
  const t = useT()
  const description = localizedToolDescription(tool.name, tool.description, useLocaleCode())
  const hints = tool.annotations
  return (
    <li className={hubBlock}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[13px] font-semibold text-ink">{tool.name}</code>
        {hints?.readOnlyHint ? <Badge tone="ok">{t('integration.webmcpReadOnly')}</Badge> : null}
        {hints?.consequentialHint ? <Badge tone="warn">{t('integration.webmcpConsequential')}</Badge> : null}
        {hints?.untrustedContentHint ? <Badge tone="neutral">{t('integration.webmcpUntrusted')}</Badge> : null}
      </div>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">{description}</p>
    </li>
  )
}

const SETUP = 'setup'

function ServerModeNote() {
  const t = useT()
  const connection = useMcpConnection()
  if (connection.status !== 'ready') return null
  return <p className="m-0 text-xs leading-relaxed text-ink-soft">{t(connection.connection.available ? 'integration.webmcpModeLocal' : 'integration.webmcpModeEdge')}</p>
}

/** WebMCP 子页：左半「接入 + 已注册分组」与工具说明，右半浏览器支持状态与启用步骤 */
export function WebMcpView() {
  const t = useT()
  const [report, setReport] = useState<WebMcpSupportReport | null>(null)
  const [section, setSection] = useState<string>(SETUP)
  const tools = useRegisteredTools()

  useEffect(() => setReport(getWebMcpSupportReport()), [])

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, tools: tools.filter((tool) => tool.registrarId === group.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter(
        (group) => group.tools.length > 0
      ),
    [tools]
  )
  const group = groups.find((candidate) => candidate.id === section)

  const support = report ? (
    <div className={cn(integrationCard, 'md:hidden')} role="status">
      <p className={cn('m-0 text-[13px] font-semibold', report.supported ? 'text-ok' : 'text-ink')}>
        {t(report.supported ? 'integration.webmcpSupported' : 'integration.webmcpUnsupported')}
      </p>
    </div>
  ) : null

  return (
    <HubLayout
      header={
        group ? (
          <HubPaneHeader title={t(group.labelKey)} description={t('integration.toolCount', { count: group.tools.length })} />
        ) : (
          <HubPaneHeader title={t('integration.navOverview')} description={t('integration.webmcpRegistered') + ' · ' + t('integration.toolCount', { count: tools.length })} />
        )
      }
      nav={
        <HubNav label={t('integration.groupNavAria')}>
          <HubNavSection>
            <HubNavItem
              active={!group}
              icon={<LuGlobe size={15} />}
              label={t('integration.navOverview')}
              meta={t('integration.toolCount', { count: tools.length })}
              onSelect={() => setSection(SETUP)}
            />
          </HubNavSection>
          {groups.length > 0 ? (
            <HubNavSection label={t('integration.webmcpRegistered')}>
              {groups.map((candidate) => (
                <HubNavItem
                  key={candidate.id}
                  active={group?.id === candidate.id}
                  icon={<candidate.icon size={15} />}
                  label={t(candidate.labelKey)}
                  meta={t('integration.toolCount', { count: candidate.tools.length })}
                  onSelect={() => setSection(candidate.id)}
                />
              ))}
            </HubNavSection>
          ) : null}
        </HubNav>
      }
      contentKey={group?.id ?? SETUP}
      aside={{
        header: (
          <HubPaneHeader
            title={t('integration.webmcpBrowserTitle')}
            description={
              report ? (
                <span className={report.supported ? 'text-ok' : undefined}>{t(report.supported ? 'integration.webmcpSupported' : 'integration.webmcpUnsupported')}</span>
              ) : null
            }
          />
        ),
        children: (
          <>
            {report?.reason === 'no_secure_context' ? (
              <div className={integrationCard} role="note">
                <p className="m-0 text-xs text-ink-soft">{t('integration.webmcpNeedSecure')}</p>
              </div>
            ) : null}
            <section className={integrationCard} aria-labelledby="webmcp-steps-title">
              <h3 id="webmcp-steps-title" className="m-0 text-[13px] font-semibold text-ink">
                {t('integration.webmcpStepsTitle')}
              </h3>
              <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-xs leading-relaxed text-ink-soft">
                {STEP_KEYS.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ol>
            </section>
          </>
        ),
      }}
    >
      {group ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {group.tools.map((tool) => (
            <ToolBlock key={tool.name} tool={tool} />
          ))}
        </ul>
      ) : (
        <>
          {support}
          <section className={integrationCard} aria-labelledby="webmcp-modes-title">
            <h3 id="webmcp-modes-title" className="m-0 text-sm font-semibold text-ink">
              {t('integration.webmcpModesTitle')}
            </h3>
            <p className="m-0 text-xs leading-relaxed text-ink">{t('integration.webmcpIntro')}</p>
            <ServerModeNote />
            {groups.length === 0 ? <p className="m-0 text-xs text-ink-soft">{t('integration.webmcpEmpty')}</p> : null}
          </section>
        </>
      )}
    </HubLayout>
  )
}
