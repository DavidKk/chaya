/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { TranslateRunPane } from '@/components/TranslateRunPane'
import { zh } from '@/lib/i18n/messages/zh'
import { translate } from '@/lib/i18n/t'

const mockFetch = jest.fn()
const mockT = (key: Parameters<typeof translate>[1], params: Parameters<typeof translate>[2]) => translate(zh, key, params)
const mockNotify = { success: jest.fn(), error: jest.fn(), info: jest.fn() }

jest.mock('@/components/i18n/LocaleProvider', () => ({ useT: () => mockT }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => mockFetch }))
jest.mock('@/components/translate/useOptimizeNames', () => ({ useOptimizeNames: () => ({ running: false }) }))
jest.mock('@/components/translate/useSyncNames', () => ({ useSyncNames: () => ({ running: false }) }))
jest.mock('@/components/translate/useAnimatedNumber', () => ({ useAnimatedNumber: (value: number) => value }))
jest.mock('@/components/translate/TranslateExportMenu', () => ({ TranslateExportMenu: () => null }))
jest.mock('@/components/translate/TranslateOptimizeMenu', () => ({ TranslateOptimizeMenu: () => null }))
jest.mock('@/components/translate/TranslateListContent', () => ({ TranslateListContent: () => null }))
jest.mock('@/components/translate/TranslateRgssPreviewSwitch', () => ({ TranslateRgssPreviewSwitch: () => null }))
jest.mock('@/components/translate/TranslationPlaySettings', () => ({ TranslationPlaySettings: () => null }))
jest.mock('@/components/sk', () => ({
  Button: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => <button disabled={disabled}>{children}</button>,
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TruncateText: ({ text }: { text: ReactNode }) => <span>{text}</span>,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function snapshot(status = 'running', text = 'First batch complete') {
  return {
    ok: true,
    hasSeed: true,
    total: 10,
    needCount: 10,
    done: 4,
    missing: 6,
    needChars: 100,
    missingChars: 60,
    doneChars: 40,
    lines: 10,
    job: {
      status,
      sessionDone: 4,
      logs: text ? [{ id: 1, at: 1, level: 'ok', text }] : [],
    },
  }
}

function respond(data: Record<string, unknown>, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  jest.useFakeTimers()
  mockFetch.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  jest.useRealTimers()
})

async function render() {
  await act(async () => root.render(<TranslateRunPane tab="seed" />))
}

async function tick(ms: number) {
  await act(async () => jest.advanceTimersByTimeAsync(ms))
}

it.each(['transport', 'api'])('preserves the last successful snapshot on a %s failure and retries', async (failure) => {
  mockFetch.mockResolvedValue(respond(snapshot()))
  await render()
  expect(host.textContent).toContain('First batch complete')

  if (failure === 'transport') mockFetch.mockRejectedValueOnce(new Error('connection interrupted'))
  else mockFetch.mockResolvedValueOnce(respond({ ok: false, error: { message: 'connection interrupted' } }, false))

  await tick(750)
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('connection interrupted')
  expect(host.textContent).toContain('First batch complete')
  expect(host.textContent).toContain('40 字')

  mockFetch.mockResolvedValue(respond(snapshot('running', 'Next batch complete')))
  await tick(750)
  expect(host.textContent).toContain('Next batch complete')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('recovers automatically when the initial snapshot request fails', async () => {
  mockFetch.mockRejectedValueOnce(new Error('service restarting')).mockResolvedValue(respond(snapshot()))
  await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('service restarting')

  await tick(3000)
  expect(host.textContent).toContain('First batch complete')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('detects a background job after the initial idle snapshot without remounting', async () => {
  mockFetch.mockResolvedValueOnce(respond(snapshot('idle', ''))).mockResolvedValue(respond(snapshot('running', 'Background job started')))
  await render()
  expect(host.textContent).not.toContain('Background job started')

  await tick(3000)
  expect(host.textContent).toContain('Background job started')
  const calls = mockFetch.mock.calls.length
  await tick(750)
  expect(mockFetch.mock.calls).toHaveLength(calls + 1)

  await act(async () => root.unmount())
  root = createRoot(host)
  const callsAfterUnmount = mockFetch.mock.calls.length
  await tick(3000)
  expect(mockFetch.mock.calls).toHaveLength(callsAfterUnmount)
})
