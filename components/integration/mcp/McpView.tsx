'use client'

import { useCallback, useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard, McpConnectionCard } from '@/components/integration/mcp/McpConnectionCard'
import { McpPlayground } from '@/components/integration/mcp/McpPlayground'
import { McpToolCard } from '@/components/integration/mcp/McpToolCard'
import { exampleArgs } from '@/components/integration/mcp/schema'
import { useMcpConnection } from '@/components/integration/mcp/useMcpConnection'
import { ScrollArea, Spinner } from '@/components/sk'
import { MCP_TOOLS, mcpToolsByGroup } from '@/lib/integration/mcp-catalog'
import { cn } from '@/lib/utils'

function argsTextFor(name: string): string {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name)
  return JSON.stringify(tool ? exampleArgs(tool.inputSchema) : {}, null, 2)
}

/** MCP 子页：连接信息（仅本机）+ 全量工具文档 + 试调 */
export function McpView() {
  const t = useT()
  const state = useMcpConnection()
  const contentNote = t('integration.mcpContentNote')
  const connection = state.status === 'ready' && state.connection.available ? state.connection : null
  const groups = useMemo(() => mcpToolsByGroup(), [])
  const playgroundTools = useMemo(() => MCP_TOOLS.filter((tool) => !tool.evalOnly || connection?.evalEnabled), [connection])

  const [toolName, setToolName] = useState<string>(MCP_TOOLS[0].name)
  const [argsText, setArgsText] = useState(() => argsTextFor(MCP_TOOLS[0].name))

  const selectTool = useCallback((name: string) => {
    setToolName(name)
    setArgsText(argsTextFor(name))
  }, [])

  const tryTool = useCallback(
    (name: string) => {
      selectTool(name)
      document.getElementById('mcp-playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [selectTool]
  )

  return (
    <ScrollArea className="h-full min-h-0" indicator="vertical">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4">
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

        {connection ? <McpPlayground tools={playgroundTools} toolName={toolName} argsText={argsText} onToolChange={selectTool} onArgsChange={setArgsText} /> : null}

        <section className="flex flex-col gap-3" aria-labelledby="mcp-tools-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="mcp-tools-title" className="m-0 text-base font-semibold text-ink">
              {t('integration.toolsTitle')}
            </h2>
            <span className="text-xs text-ink-soft">{t('integration.toolCount', { count: MCP_TOOLS.length })}</span>
          </div>
          {contentNote ? <p className="m-0 text-xs text-ink-soft">{contentNote}</p> : null}
          <nav aria-label={t('integration.groupNavAria')} className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <a
                key={group.id}
                href={`#group-${group.id}`}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full border border-line bg-panel px-3 text-xs text-ink-soft no-underline transition-colors',
                  'hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                )}
              >
                {group.title}
                <span className="font-mono text-[11px]">{group.tools.length}</span>
              </a>
            ))}
          </nav>
          {groups.map((group) => (
            <div key={group.id} id={`group-${group.id}`} className="flex scroll-mt-4 flex-col gap-2 pt-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="m-0 text-sm font-semibold text-ink">{group.title}</h3>
                <p className="m-0 text-xs text-ink-soft">{group.summary}</p>
              </div>
              {group.tools.map((tool) => (
                <McpToolCard key={tool.name} tool={tool} onTry={connection && (!tool.evalOnly || connection.evalEnabled) ? tryTool : undefined} />
              ))}
            </div>
          ))}
        </section>
      </div>
    </ScrollArea>
  )
}
