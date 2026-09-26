/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { GameEditLogsPane } from '@/components/game-edit/GameEditLogsPane'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  })
})

afterEach(() => {
  window.localStorage.removeItem('chaya.locale')
})

test('uses the shared Web level filter and copies only the visible entries', async () => {
  let entries = [
    { id: 1, ts: Date.UTC(2026, 0, 1), level: 'info', source: 'ChayaEdit', message: 'ready' },
    { id: 2, ts: Date.UTC(2026, 0, 1, 0, 0, 1), level: 'warn', source: 'ChayaTrans', message: 'retry', meta: { attempt: 2 } },
  ]
  const listeners = new Set<() => void>()
  const clear = jest.fn(() => {
    entries = []
    listeners.forEach((listener) => listener())
  })
  Object.assign(window, {
    ChayaLog: {
      history: () => entries,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      clear,
    },
  })
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  shadow.append(mount)
  document.body.append(host)
  const root = createRoot(mount)

  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh">
          <GameEditLogsPane />
        </LocaleProvider>
      )
    )
    expect(shadow.querySelectorAll('[aria-label="局内插件日志"] tbody tr')).toHaveLength(2)
    expect(shadow.textContent).not.toContain('实时流')
    expect(shadow.querySelector('[aria-label="暂停"]')).toBeNull()
    expect(shadow.querySelector('[aria-label="搜索日志"]')).not.toBeNull()
    await act(async () => shadow.querySelector<HTMLButtonElement>('[aria-label="日志等级"]')!.click())
    const options = [...shadow.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options).toHaveLength(5)
    expect(document.querySelector('[aria-label="日志等级"]')).toBeNull()
    expect(shadow.querySelector<HTMLButtonElement>('[aria-label="日志等级"]')?.parentElement?.className).toContain('min-w-[9.5rem]')
    expect(options.every((option) => option.querySelector('button > span')?.className.includes('w-[0.9rem]'))).toBe(true)
    for (const option of options.filter((item) => !item.textContent?.includes('warn'))) {
      await act(async () => option.querySelector<HTMLButtonElement>('button')!.click())
    }
    for (const option of options) {
      expect(option.querySelector('svg')?.classList.contains('invisible')).toBe(!option.textContent?.includes('warn'))
    }
    expect(shadow.querySelectorAll('[aria-label="局内插件日志"] tbody tr')).toHaveLength(1)
    expect(mount.textContent).toContain('retry')
    expect(mount.textContent).not.toContain('ready')

    const copy = shadow.querySelector<HTMLButtonElement>('[aria-label="复制当前日志"]')!
    expect(copy.textContent).toBe('')
    await act(async () => copy.click())
    expect(writeText).toHaveBeenCalledWith('2026-01-01T00:00:01.000Z [WARN] ChayaTrans: retry\n{"attempt":2}')
    expect(shadow.querySelector('[role="status"]')?.textContent).toBe('已复制 1 条')

    await act(async () => shadow.querySelector<HTMLButtonElement>('[aria-label="清空"]')!.click())
    expect(clear).toHaveBeenCalledTimes(1)
    expect(shadow.textContent).toContain('无匹配结果')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    Reflect.deleteProperty(window, 'ChayaLog')
  }
})
