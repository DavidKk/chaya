/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameEditHotkeysPane } from '@/components/game-edit/GameEditHotkeysPane'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import type { RuleBinding } from '@/lib/game/input-assistance'

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

const assist: RuleBinding[] = [
  { ruleId: 'r1', field: 'trigger', name: '右左', chord: [{ kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81, location: 0 }] },
  { ruleId: 'r2', field: 'trigger', name: '面板宏', chord: [{ kind: 'key', code: 'Backquote', key: '`', keyCode: 192, location: 0 }] },
]

test('marks the effective Chaya hotkey cell that collides with a key-mouse trigger', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditHotkeysPane gameValue={{ 'flag:god': 'Ctrl+Q' }} globalValue={{ 'flag:god': 'W' }} onGameChange={() => {}} onGlobalChange={() => {}} assistBindings={assist} />
      </LocaleProvider>
    )
  )
  const conflicted = [...host.querySelectorAll('input')].filter((input) => input.getAttribute('aria-label')?.includes('键鼠工具'))
  expect(conflicted.map((input) => input.getAttribute('aria-label'))).toEqual([expect.stringMatching(/唤出作弊器.*“面板宏”/), expect.stringMatching(/无敌.*本游戏.*“右左”/)])
  expect(conflicted.every((input) => input.parentElement?.className.includes('border-warn'))).toBe(true)
})
