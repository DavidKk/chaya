// Real management controls, attached to one test game host through a loopback-only bridge.
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { CompanionMemoryControls } from '@/components/game-agent/CompanionMemoryControls'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import type { CompanionHostRequest, CompanionHostStatus } from '@/lib/runtime/companion-protocol'

async function call<T>(message: CompanionHostRequest): Promise<T> {
  const response = await fetch('/__smoke/panels/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body.value as T
}

function Panel() {
  const [status, setStatus] = useState<CompanionHostStatus | null>(null)
  const [notice, setNotice] = useState('')
  const refresh = useCallback(() => {
    void call<CompanionHostStatus>({ type: 'agent.companion.status', requestId: crypto.randomUUID() }).then(setStatus, (error) => setNotice(String(error)))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 1_000)
    return () => clearInterval(timer)
  }, [refresh])
  return (
    <LocaleProvider initialLocale="zh" initialPreference="zh">
      <ConfirmProvider>
        <h1>旅伴管理验收面板</h1>
        <p>官方 MV 样例 · 隔离测试数据 · 两个面板连接同一个游戏宿主</p>
        {status ? (
          <>
            <CompanionMemoryControls
              locale="zh"
              hostStatus={status}
              controlBusy={false}
              activityVisible={false}
              onStartControl={() => {}}
              onStopControl={() => {}}
              onToggleActivity={() => {}}
              onClearChat={() => {}}
            />
            <p role="status">
              记录：{status.memory.recording ? '开启' : '关闭'} · 记忆版本：{status.memory.epoch}
            </p>
          </>
        ) : (
          <p role="status">连接游戏宿主…</p>
        )}
        {notice && <p role="alert">{notice}</p>}
      </ConfirmProvider>
    </LocaleProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Panel />)
