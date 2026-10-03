'use client'

import { useCallback, useMemo, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuActivity, LuDatabase, LuGamepad2, LuLanguages, LuLibrary, LuPlug, LuScrollText, LuWrench } from 'react-icons/lu'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { integrationCard, McpConnectionCard } from '@/components/integration/mcp/McpConnectionCard'
import { McpPlayground } from '@/components/integration/mcp/McpPlayground'
import { McpToolCard } from '@/components/integration/mcp/McpToolCard'
import { exampleArgs } from '@/components/integration/mcp/schema'
import { useMcpConnection } from '@/components/integration/mcp/useMcpConnection'
import { Spinner } from '@/components/sk'
import { MCP_ENDPOINT_PATH, MCP_TOOLS, type McpToolGroupId, type McpToolMeta } from '@/lib/integration/mcp-catalog'
import { localizedMcpToolsByGroup } from '@/lib/integration/mcp-catalog-i18n'

const SETUP = 'setup'

const GROUP_ICONS: Record<McpToolGroupId, IconType> = {
  library: LuLibrary,
  game: LuGamepad2,
  live: LuActivity,
  edit: LuWrench,
  translate: LuLanguages,
  cache: LuDatabase,
  logs: LuScrollText,
}

function argsTextFor(name: string): string {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name)
  return JSON.stringify(tool ? exampleArgs(tool.inputSchema) : {}, null, 2)
}

/** MCP 子页：左半「说明」（分组导航 + 文档），右半「试调」 */
export function McpView() {
  const t = useT()
  const state = useMcpConnection()
  const locale = useLocaleCode()
  const connection = state.status === 'ready' && state.connection.available ? state.connection : null
  const groups = useMemo(() => localizedMcpToolsByGroup(locale), [locale])
  const playgroundTools = useMemo(() => MCP_TOOLS.filter((tool) => !tool.evalOnly || connection?.evalEnabled), [connection])
  const callable = useCallback((tool: McpToolMeta) => Boolean(connection && (!tool.evalOnly || connection.evalEnabled)), [connection])

  const [section, setSection] = useState<string>(SETUP)
  const [toolName, setToolName] = useState<string>(MCP_TOOLS[0].name)
  const [argsText, setArgsText] = useState(() => argsTextFor(MCP_TOOLS[0].name))
  const group = groups.find((candidate) => candidate.id === section)

  const selectTool = useCallback((name: string) => {
    setToolName(name)
    setArgsText(argsTextFor(name))
  }, [])

  const selectSection = useCallback(
    (id: string) => {
      setSection(id)
      const first = groups.find((candidate) => candidate.id === id)?.tools.find(callable)
      if (first) selectTool(first.name)
    },
    [callable, groups, selectTool]
  )

  return (
    <HubLayout
      header={
        <HubPaneHeader title={group ? group.title : t('integration.navOverview')} description={group ? group.summary : t('integration.toolCount', { count: MCP_TOOLS.length })} />
      }
      nav={
        <HubNav label={t('integration.groupNavAria')}>
          <HubNavSection>
            <HubNavItem active={!group} icon={<LuPlug size={15} />} label={t('integration.navOverview')} meta={MCP_ENDPOINT_PATH} onSelect={() => setSection(SETUP)} />
          </HubNavSection>
          <HubNavSection label={t('integration.groupNavAria')}>
            {groups.map((candidate) => {
              const Icon = GROUP_ICONS[candidate.id]
              return (
                <HubNavItem
                  key={candidate.id}
                  active={group?.id === candidate.id}
                  icon={<Icon size={15} />}
                  label={candidate.title}
                  meta={t('integration.toolCount', { count: candidate.tools.length })}
                  title={candidate.summary}
                  onSelect={() => selectSection(candidate.id)}
                />
              )
            })}
          </HubNavSection>
        </HubNav>
      }
      contentKey={section}
      aside={{
        header: <HubPaneHeader title={t('integration.playground')} description={t('integration.playgroundHint')} />,
        children: connection ? (
          <McpPlayground tools={playgroundTools} toolName={toolName} argsText={argsText} onToolChange={selectTool} onArgsChange={setArgsText} />
        ) : state.status === 'loading' ? (
          <Spinner size="sm" label={t('common.loading')} />
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
            <p className="m-0 text-[13px] font-semibold text-ink">{t('integration.mcpUnavailableTitle')}</p>
            <p className="m-0 max-w-sm text-xs text-ink-soft">{t('integration.playgroundUnavailable')}</p>
          </div>
        ),
      }}
    >
      {group ? (
        group.tools.map((tool) => <McpToolCard key={tool.name} tool={tool} active={callable(tool) && tool.name === toolName} onTry={callable(tool) ? selectTool : undefined} />)
      ) : (
        <>
          <p className="m-0 text-[13px] leading-relaxed text-ink">{t('integration.mcpIntro')}</p>
          {state.status === 'loading' ? (
            <div className="flex items-center gap-2 text-xs text-ink-soft">
              <Spinner size="sm" label={t('common.loading')} />
            </div>
          ) : state.status === 'error' ? (
            <div className={integrationCard} role="alert">
              <p className="m-0 text-[13px] font-semibold text-fail">{t('integration.mcpLoadFailed')}</p>
              <p className="m-0 text-xs text-ink-soft">{state.message}</p>
            </div>
          ) : connection ? (
            <McpConnectionCard connection={connection} />
          ) : (
            <div className={integrationCard} role="note">
              <p className="m-0 text-[13px] font-semibold text-ink">{t('integration.mcpUnavailableTitle')}</p>
              <p className="m-0 text-xs text-ink-soft">{t('integration.mcpUnavailableHint')}</p>
            </div>
          )}
        </>
      )}
    </HubLayout>
  )
}
