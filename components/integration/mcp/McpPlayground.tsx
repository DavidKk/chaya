'use client'

import { useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { parseArgsJson, readToolCallResponse, type ToolCallOutcome } from '@/components/integration/mcp/schema'
import { Button, Select, Spinner } from '@/components/sk'
import { formControlChrome, formControlPadX } from '@/components/sk/control'
import { readApiErrorMessage } from '@/lib/api-error'
import { MCP_ENDPOINT_PATH, type McpToolMeta } from '@/lib/integration/mcp-catalog'
import { cn } from '@/lib/utils'

export type PlaygroundProps = {
  tools: readonly McpToolMeta[]
  toolName: string
  argsText: string
  onToolChange: (name: string) => void
  onArgsChange: (text: string) => void
}

/** 页面内直接调本机 `/api/mcp`（cookie 鉴权），结果与 Agent 所见一致 */
export function McpPlayground({ tools, toolName, argsText, onToolChange, onArgsChange }: PlaygroundProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<(ToolCallOutcome & { tool: string }) | null>(null)
  const outcome = last?.tool === toolName ? last : null
  const options = useMemo(() => tools.map((tool) => ({ value: tool.name, label: tool.name })), [tools])

  async function run() {
    const tool = toolName
    const args = parseArgsJson(argsText)
    if (!args) {
      setLast({ tool, isError: true, text: t('integration.invalidJson') })
      return
    }
    setBusy(true)
    setLast(null)
    try {
      const res = await fetch(MCP_ENDPOINT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
      })
      const data: unknown = await res.json().catch(() => null)
      setLast({ tool, ...(res.ok ? readToolCallResponse(data) : { isError: true, text: readApiErrorMessage(data, `HTTP ${res.status}`) }) })
    } catch (error) {
      setLast({ tool, isError: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="mcp-playground" className={cn(integrationCard, 'scroll-mt-4')} aria-label={t('integration.playground')}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[13px] font-semibold text-ink">{t('integration.playground')}</h2>
        <p className="m-0 text-xs text-ink-soft">{t('integration.playgroundHint')}</p>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-ink-soft">{t('integration.playgroundTool')}</span>
        <Select value={toolName} options={options} onChange={onToolChange} />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-ink-soft">{t('integration.playgroundArgs')}</span>
        <textarea
          className={cn(formControlChrome, formControlPadX, 'h-auto min-h-[6rem] resize-y py-2 font-mono text-xs leading-snug focus:border-accent')}
          value={argsText}
          spellCheck={false}
          onChange={(event) => onArgsChange(event.target.value)}
        />
      </label>
      <div>
        <Button variant="accent" disabled={busy || !toolName} onClick={() => void run()}>
          {busy ? <Spinner size="sm" label={t('common.loading')} /> : null}
          {t('integration.run')}
        </Button>
      </div>
      {outcome ? (
        <div className="flex flex-col gap-2" role="status">
          <span className={cn('text-xs font-semibold', outcome.isError ? 'text-fail' : 'text-ink-soft')}>
            {outcome.isError ? t('integration.resultError') : t('integration.result')}
          </span>
          <pre className="m-0 max-h-[28rem] overflow-auto rounded-[0.3rem] border border-line bg-inset px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-all text-ink">
            {outcome.text}
          </pre>
        </div>
      ) : null}
    </section>
  )
}
