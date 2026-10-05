/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

jest.mock('@/components/game-edit/GameEditMcpPane', () => ({ GameEditMcpPane: () => <div>MCP content</div> }))
jest.mock('@/components/game-edit/GameEditSkillsPane', () => ({ GameEditSkillsPane: () => <div>Skill content</div> }))
jest.mock('@/components/game-edit/GameEditWebMcpPane', () => ({ GameEditWebMcpPane: () => <div>WebMCP content</div> }))

import { GameEditIntegrationPane } from '@/components/game-edit/GameEditIntegrationPane'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('game integration exposes icon navigation for Skill, MCP, and WebMCP', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditIntegrationPane />
      </LocaleProvider>
    )
  )

  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('aside button'))
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Skills', 'MCP', 'WebMCP'])
  expect(host.textContent).toContain('MCP content')

  await act(async () => buttons[0].click())
  expect(host.textContent).toContain('Skill content')
  await act(async () => buttons[2].click())
  expect(host.textContent).toContain('WebMCP content')
})
