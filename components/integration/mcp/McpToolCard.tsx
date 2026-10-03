'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { hubBlock, hubBlockActive } from '@/components/integration/Hub'
import { toolParamRows } from '@/components/integration/mcp/schema'
import { Badge, Button } from '@/components/sk'
import type { McpToolMeta } from '@/lib/integration/mcp-catalog'
import { cn } from '@/lib/utils'

/** 单个工具：名称、说明、参数表、对应 HTTP 接口；可用时带「试调」 */
export function McpToolCard({ tool, active = false, onTry }: { tool: McpToolMeta; active?: boolean; onTry?: (name: string) => void }) {
  const t = useT()
  const rows = toolParamRows(tool.inputSchema)

  return (
    <article id={`tool-${tool.name}`} className={cn(hubBlock, 'scroll-mt-4 transition-[background,border-color] duration-150', active && hubBlockActive)}>
      <header className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[13px] font-semibold text-ink">{tool.name}</code>
        <span className="text-xs text-ink-soft">{tool.title}</span>
        {tool.destructive ? <Badge tone="fail">{t('integration.destructive')}</Badge> : null}
        {tool.evalOnly ? <Badge tone="warn">{t('integration.evalOnly')}</Badge> : null}
        {onTry ? (
          <Button variant="ghost" className="ml-auto max-md:hidden" onClick={() => onTry(tool.name)}>
            {t('integration.tryTool')}
          </Button>
        ) : null}
      </header>
      <p className="m-0 text-[12.5px] leading-relaxed text-ink">{tool.description}</p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" aria-label={`${tool.name} ${t('integration.params')}`}>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-line-soft first:border-t-0">
                  <td className="py-2 pr-3 align-top whitespace-nowrap">
                    <code className="font-mono text-ink">{row.name}</code>
                  </td>
                  <td className="py-2 pr-3 align-top font-mono whitespace-nowrap text-ink-soft">{row.type}</td>
                  <td className="py-2 pr-3 align-top whitespace-nowrap text-ink-soft">{row.required ? t('integration.required') : t('integration.optional')}</td>
                  <td className="py-2 align-top text-ink-soft">
                    {row.description}
                    {row.enumValues ? <span className="ml-1 font-mono text-[11px]">({row.enumValues.join(' | ')})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 text-xs text-ink-soft">{t('integration.noParams')}</p>
      )}
      {tool.http ? (
        <p className="m-0 text-xs text-ink-soft">
          {t('integration.http')}: <code className="font-mono">{tool.http}</code>
        </p>
      ) : null}
    </article>
  )
}
