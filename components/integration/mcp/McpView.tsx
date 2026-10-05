'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuActivity, LuDatabase, LuGamepad2, LuLanguages, LuLibrary, LuPlug, LuScrollText, LuWrench } from 'react-icons/lu'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { integrationCard, McpConnectionCard } from '@/components/integration/mcp/McpConnectionCard'
import { McpPlayground, type McpRpc } from '@/components/integration/mcp/McpPlayground'
import { McpToolCard } from '@/components/integration/mcp/McpToolCard'
import { exampleArgs } from '@/components/integration/mcp/schema'
import { useMcpConnection } from '@/components/integration/mcp/useMcpConnection'
import { EmptyState, Spinner } from '@/components/sk'
import { mcpToolsFor } from '@/lib/integration/mcp-availability'
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

/** In-game host: plugin-MCP tool set, gateway overview, playground through `ChayaAgent.gateway.rpc` */
export type McpGameHost = { overview: ReactNode; rpc: McpRpc }

type HubProps = {
  /** Tools this form serves; `null` while still loading */
  tools: readonly McpToolMeta[] | null
  /** Tools listed but not callable here (eval off) */
  callable: (tool: McpToolMeta) => boolean
  overview: ReactNode
  endpointMeta?: string
  rpc?: McpRpc
}

/** MCP 子页：左半「说明」（分组导航 + 文档），右半「试调」；本机服务与游戏内共用 */
function McpHub({ tools, callable, overview, endpointMeta, rpc }: HubProps) {
  const t = useT()
  const locale = useLocaleCode()
  const groups = useMemo(() => {
    const names = new Set(tools?.map((tool) => tool.name))
    return localizedMcpToolsByGroup(locale)
      .map((group) => ({ ...group, tools: group.tools.filter((tool) => names.has(tool.name)) }))
      .filter((group) => group.tools.length > 0)
  }, [locale, tools])
  const playgroundTools = useMemo(() => (tools ?? []).filter(callable), [callable, tools])

  const [section, setSection] = useState<string>(SETUP)
  const [toolName, setToolName] = useState<string>(() => playgroundTools[0]?.name ?? MCP_TOOLS[0].name)
  const [argsText, setArgsText] = useState(() => argsTextFor(toolName))
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
        <HubPaneHeader
          title={group ? group.title : t('integration.navOverview')}
          description={group ? group.summary : tools ? t('integration.toolCount', { count: tools.length }) : null}
        />
      }
      nav={
        <HubNav label={t('integration.groupNavAria')}>
          <HubNavSection>
            <HubNavItem active={!group} icon={<LuPlug size={15} />} label={t('integration.navOverview')} meta={endpointMeta} onSelect={() => setSection(SETUP)} />
          </HubNavSection>
          {groups.length > 0 ? (
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
          ) : null}
        </HubNav>
      }
      contentKey={section}
      aside={{
        header: <HubPaneHeader title={t('integration.playground')} description={t('integration.playgroundHint')} />,
        children: tools ? (
          <McpPlayground tools={playgroundTools} toolName={toolName} argsText={argsText} onToolChange={selectTool} onArgsChange={setArgsText} rpc={rpc} />
        ) : (
          <Spinner size="sm" label={t('common.loading')} />
        ),
      }}
    >
      {group
        ? group.tools.map((tool) => <McpToolCard key={tool.name} tool={tool} active={callable(tool) && tool.name === toolName} onTry={callable(tool) ? selectTool : undefined} />)
        : overview}
    </HubLayout>
  )
}

const PLUGIN_TOOLS = mcpToolsFor('plugin')
const always = () => true

function ServerMcpView() {
  const t = useT()
  const state = useMcpConnection()
  const connection = state.status === 'ready' && state.connection.available ? state.connection : null
  const callable = useCallback((tool: McpToolMeta) => Boolean(connection && (!tool.evalOnly || connection.evalEnabled)), [connection])

  if (state.status === 'ready' && !state.connection.available) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState title={t('mcpGateway.edgeTitle')} message={t('mcpGateway.edgeBody')} />
      </div>
    )
  }

  const overview =
    state.status === 'loading' ? (
      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <Spinner size="sm" label={t('common.loading')} />
      </div>
    ) : state.status === 'error' ? (
      <div className={integrationCard} role="alert">
        <p className="m-0 text-[13px] font-semibold text-fail">{t('integration.mcpLoadFailed')}</p>
        <p className="m-0 text-xs text-ink-soft">{state.message}</p>
      </div>
    ) : connection ? (
      <McpConnectionCard url={connection.endpoint} evalEnabled={connection.evalEnabled} />
    ) : null

  return <McpHub tools={connection ? MCP_TOOLS : null} callable={callable} overview={overview} endpointMeta={connection ? MCP_ENDPOINT_PATH : undefined} />
}

/** 本机服务：全部工具；游戏内（`game`）：插件 MCP 工具集，见 `mcpToolsFor` */
export function McpView({ game }: { game?: McpGameHost }) {
  if (!game) return <ServerMcpView />
  return <McpHub tools={PLUGIN_TOOLS} callable={always} overview={game.overview} rpc={game.rpc} />
}
