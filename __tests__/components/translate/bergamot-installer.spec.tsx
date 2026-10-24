/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { BergamotPackInstaller } from '@/components/translate/BergamotPackInstaller'
import type { PackPlan } from '@/lib/translate/bergamot'

const mockFetch = jest.fn()
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => mockFetch }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const plan: PackPlan = {
  id: 'en-zh-plan',
  source: 'en',
  target: 'zh',
  status: 'model_pack_missing',
  installed: false,
  canInstall: true,
  downloadBytes: 1000,
  requiredFreeBytes: 2000,
  packs: [{ id: 'en-zh', source: 'en', target: 'zh', installed: false, bytes: 1000, license: 'MPL-2.0', attribution: 'Mozilla' }],
}
const job = {
  id: 'job',
  planId: plan.id,
  source: 'en',
  target: 'zh',
  packIds: ['en-zh'],
  state: 'running' as const,
  phase: 'downloading' as const,
  downloadedBytes: 250,
  totalDownloadBytes: 1000,
  revision: 1,
  updatedAt: 1,
}
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body })
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
async function render(source = 'en', onInstalled = jest.fn()) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <BergamotPackInstaller source={source} target="zh" onInstalled={onInstalled} />
      </LocaleProvider>
    )
  )
  return onInstalled
}
async function click(text: string) {
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!.click())
}
it('starts only on click, displays actual progress, and refreshes after publication', async () => {
  mockFetch.mockImplementation(async (_path, init) => {
    const { action } = JSON.parse(init.body)
    return response(
      action === 'install'
        ? { ...plan, job }
        : action === 'status'
          ? { ...plan, installed: true, canInstall: false, job: { ...job, downloadedBytes: 1000, state: 'completed', phase: null, revision: 2 } }
          : plan
    )
  })
  const installed = await render()
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(installed).not.toHaveBeenCalled()
  await click('安装语言包')
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
  await act(async () => jest.advanceTimersByTime(1000))
  expect(installed).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('就绪')
  expect(mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body).action)).toEqual(['plan', 'install', 'status'])
})
it('ignores an old language response and does not cancel the shared task when unmounted', async () => {
  let resolveOld!: (value: unknown) => void
  mockFetch.mockImplementation(async (_path, init) =>
    JSON.parse(init.body).from === 'en'
      ? new Promise((resolve) => {
          resolveOld = resolve
        })
      : response({ ...plan, source: 'ja', status: 'unsupported_pair', canInstall: false, packs: [] })
  )
  await render()
  await render('ja')
  await act(async () => resolveOld(response({ ...plan, job })))
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  expect(host.textContent).not.toContain('Mozilla')
  expect(mockFetch.mock.calls.some(([, init]) => JSON.parse(init.body).action === 'cancel')).toBe(false)
})
it('shows console guidance on a management rejection without exposing an install button', async () => {
  mockFetch.mockResolvedValue(response({ ok: false }, 403))
  await render()
  expect(host.textContent).toContain('请在本机 Chaya 控制台安装语言包')
  expect(host.textContent).not.toContain('点击安装即可')
})
it('does not refresh in a loop when opening a previously completed installation', async () => {
  mockFetch.mockResolvedValue(response({ ...plan, installed: true, canInstall: false, job: { ...job, state: 'completed', phase: null } }))
  const installed = await render()
  await act(async () => jest.advanceTimersByTime(5000))
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(installed).not.toHaveBeenCalled()
})
