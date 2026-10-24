/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DebugMenu } from '@/components/debug/DebugMenu'
import { setGameUiDebugScenarioId, useGameUiDebugScenarioId, useGameUiDebugState } from '@/components/debug/game-ui-debug'
import { GameDebug } from '@/components/debug/GameDebug'
import { DebugMenuProvider } from '@/components/debug/registry'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  setGameUiDebugScenarioId(null)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setGameUiDebugScenarioId(null)
})

function Probe() {
  const state = useGameUiDebugState()
  const scenarioId = useGameUiDebugScenarioId()
  return <span data-state={scenarioId ?? 'live'}>{state ? 'overridden' : 'live'}</span>
}

it('registers a UI debug group and switches preview state without real commands', async () => {
  const prevEnv = process.env.NODE_ENV
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <DebugMenuProvider>
            <GameDebug />
            <DebugMenu />
            <Probe />
          </DebugMenuProvider>
        </LocaleProvider>
      )
    )

    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="调试菜单"]')
    expect(trigger).not.toBeNull()
    await act(async () => trigger!.click())

    const menu = document.querySelector('[aria-label="调试菜单"].flex') || document.body
    expect(menu.textContent).toContain('UI 调试')
    expect(menu.textContent).toContain('实况数据')
    expect(menu.textContent).toContain('未装壳')
    expect(menu.textContent).toContain('远程会话')
    expect(menu.textContent).toContain('连接中')

    const onlineBtn = Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent === '运行中')
    expect(onlineBtn).toBeDefined()
    await act(async () => onlineBtn!.click())

    expect(host.querySelector('[data-state]')?.getAttribute('data-state')).toBe('online')
    expect(host.textContent).toContain('overridden')

    const liveBtn = Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent === '实况数据')
    await act(async () => liveBtn!.click())
    expect(host.querySelector('[data-state]')?.getAttribute('data-state')).toBe('live')
  } finally {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
  }
})
