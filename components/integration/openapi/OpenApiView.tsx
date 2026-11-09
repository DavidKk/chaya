'use client'

import { useCallback, useMemo, useState } from 'react'
import { LuExternalLink, LuSend } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { hubBlock, HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { Badge, Button, CopyField, Spinner } from '@/components/sk'
import { OPENAPI_ENDPOINTS, OPENAPI_GROUPS } from '@/lib/integration/openapi-catalog'
import { cn } from '@/lib/utils'

function methodBadgeClass(method: string): string {
  switch (method) {
    case 'GET':
      return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
    case 'POST':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
    case 'PUT':
      return 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
    case 'DELETE':
      return 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
    default:
      return 'bg-white/10 text-ink border border-line'
  }
}

export function OpenApiView() {
  const t = useT()
  const [activeId, setActiveId] = useState<string>(OPENAPI_ENDPOINTS[0].id)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ status: number; body: string } | null>(null)

  const activeEndpoint = useMemo(() => OPENAPI_ENDPOINTS.find((ep) => ep.id === activeId) ?? OPENAPI_ENDPOINTS[0], [activeId])

  const runTest = useCallback(async () => {
    setBusy(true)
    setTestResult(null)
    try {
      const isGet = activeEndpoint.method === 'GET'
      const isDelete = activeEndpoint.method === 'DELETE'
      let body: string | undefined
      if (!isGet && !isDelete && activeEndpoint.requestBody?.example) {
        body = activeEndpoint.requestBody.example
      }
      const res = await fetch(activeEndpoint.path, {
        method: activeEndpoint.method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      })
      const text = await res.text()
      let formatted = text
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // ignore
      }
      setTestResult({ status: res.status, body: formatted })
    } catch (err) {
      setTestResult({ status: 500, body: String(err) })
    } finally {
      setBusy(false)
    }
  }, [activeEndpoint])

  const curlCommand = useMemo(() => {
    const method = activeEndpoint.method
    const url = `http://127.0.0.1:3000${activeEndpoint.path}`
    if (method === 'GET') return `curl -sS "${url}"`
    if (activeEndpoint.requestBody?.example) {
      const singleLine = JSON.stringify(JSON.parse(activeEndpoint.requestBody.example))
      return `curl -sS -X ${method} "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${singleLine}'`
    }
    return `curl -sS -X ${method} "${url}"`
  }, [activeEndpoint])

  return (
    <HubLayout
      contentKey={activeEndpoint.id}
      header={
        <HubPaneHeader
          title={t('integration.openApiTitle')}
          description={t('integration.openApiDesc')}
          actions={
            <Button variant="outline-accent" size="md" onClick={() => window.open('/api/openapi', '_blank')} tooltip="查看原生 OpenAPI 3.0 JSON 描述文件">
              <LuExternalLink size={14} className="mr-1.5" />
              OpenAPI 3.0 JSON
            </Button>
          }
        />
      }
      nav={
        <HubNav label="OpenAPI Endpoints">
          {OPENAPI_GROUPS.map((group) => {
            const items = OPENAPI_ENDPOINTS.filter((ep) => ep.group === group.id)
            if (!items.length) return null
            const GroupIcon = group.icon
            return (
              <HubNavSection key={group.id} label={group.label}>
                {items.map((ep) => {
                  const active = ep.id === activeEndpoint.id
                  return (
                    <HubNavItem
                      key={ep.id}
                      active={active}
                      icon={<GroupIcon size={15} />}
                      label={ep.title}
                      meta={`${ep.method} ${ep.path}`}
                      onSelect={() => {
                        setActiveId(ep.id)
                        setTestResult(null)
                      }}
                    />
                  )
                })}
              </HubNavSection>
            )
          })}
        </HubNav>
      }
      aside={{
        header: (
          <HubPaneHeader
            title="接口测试与 cURL"
            description="在本地直接发起请求或复制 cURL 命令"
            actions={
              <Button variant="accent" size="md" onClick={runTest} disabled={busy}>
                {busy ? <Spinner size="sm" className="mr-1.5" /> : <LuSend size={14} className="mr-1.5" />}
                发送请求
              </Button>
            }
          />
        ),
        children: (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-ink-soft">cURL 命令</span>
              <CopyField value={curlCommand} label="cURL command" />
            </div>
            {activeEndpoint.requestBody ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-ink-soft">请求体示例 (JSON)</span>
                <pre className="max-h-56 overflow-auto rounded bg-black/40 p-3 font-mono text-xs text-ink select-all">{activeEndpoint.requestBody.example}</pre>
              </div>
            ) : null}
            {testResult ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-soft">响应结果</span>
                  <Badge tone={testResult.status >= 200 && testResult.status < 300 ? 'ok' : 'warn'}>HTTP {testResult.status}</Badge>
                </div>
                <pre className="max-h-72 overflow-auto rounded border border-line bg-black/50 p-3 font-mono text-xs text-ink select-all">{testResult.body}</pre>
              </div>
            ) : (
              <div className="rounded border border-dashed border-line-soft p-4 text-center text-xs text-ink-soft">点击右上角「发送请求」可在当前环境测试此接口</div>
            )}
          </div>
        ),
      }}
    >
      <div className="flex flex-col gap-3">
        <section className={integrationCard}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded px-1.5 py-0.5 font-mono text-[11px] font-bold', methodBadgeClass(activeEndpoint.method))}>{activeEndpoint.method}</span>
            <code className="font-mono text-sm font-semibold text-ink">{activeEndpoint.path}</code>
          </div>
          <p className="m-0 text-xs leading-relaxed text-ink-soft">{activeEndpoint.description}</p>
        </section>

        {activeEndpoint.params?.length ? (
          <section className={hubBlock}>
            <h4 className="m-0 text-xs font-semibold text-ink uppercase tracking-wide">请求参数</h4>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {activeEndpoint.params.map((param) => (
                <li key={param.name} className="flex flex-col gap-1 rounded bg-black/20 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-ink">{param.name}</span>
                    <span className="text-[11px] text-ink-soft">({param.in})</span>
                    {param.required ? <Badge tone="warn">必填</Badge> : <Badge tone="neutral">可选</Badge>}
                  </div>
                  <span className="text-ink-soft">{param.description}</span>
                  {param.example ? <span className="font-mono text-[11px] text-ink-soft">示例: {param.example}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={hubBlock}>
          <div className="flex items-center justify-between">
            <h4 className="m-0 text-xs font-semibold text-ink uppercase tracking-wide">响应数据结构示例</h4>
            <Badge tone="ok">200 OK</Badge>
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-black/40 p-3 font-mono text-xs text-ink select-all">{activeEndpoint.responseExample}</pre>
        </section>
      </div>
    </HubLayout>
  )
}
