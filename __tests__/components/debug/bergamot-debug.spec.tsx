/** @jest-environment jsdom */
import { act, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { previewPlan } from '@/components/debug/BergamotDebug'
import { DebugMenuProvider, useDebugMenuEntries, useDebugMenuRegistration } from '@/components/debug/registry'
import { DownloadItemRow } from '@/components/downloads/DownloadItemRow'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { BergamotPackGuide } from '@/components/translate/BergamotPackGuide'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
function Registration({ label }: { label: string }) {
  const entry = useMemo(() => ({ id: 'test', title: label, actions: [] }), [label])
  useDebugMenuRegistration(entry)
  return null
}
function Entries() {
  return (
    <span>
      {useDebugMenuEntries()
        .map((item) => item.title)
        .join(',')}
    </span>
  )
}
it('updates registered sections and unregisters them on unmount', async () => {
  const render = async (label?: string) =>
    act(async () =>
      root.render(
        <DebugMenuProvider>
          {label ? <Registration label={label} /> : null}
          <Entries />
        </DebugMenuProvider>
      )
    )
  await render('first')
  expect(host.textContent).toBe('first')
  await render('updated')
  expect(host.textContent).toBe('updated')
  await render()
  expect(host.textContent).toBe('')
})
it('renders production guide states without fetching and keeps verification indeterminate', async () => {
  const fetchSpy = jest.fn()
  const previous = globalThis.fetch
  globalThis.fetch = fetchSpy
  try {
    for (const state of ['checking', 'missing', 'downloading', 'verifying', 'ready', 'failed', 'unsupported'] as const) {
      await act(async () =>
        root.render(
          <LocaleProvider initialLocale="zh" initialPreference="zh">
            <BergamotPackGuide plan={previewPlan(state)} onAction={() => {}} />
          </LocaleProvider>
        )
      )
      const bar = host.querySelector('[role="progressbar"]')
      if (state === 'downloading') expect(bar?.getAttribute('aria-valuenow')).toBe('42')
      if (state === 'verifying') {
        expect(bar).not.toBeNull()
        expect(bar?.hasAttribute('aria-valuenow')).toBe(false)
      }
      if (state === 'ready') expect(host.textContent).toContain('已就绪')
      if (state === 'unsupported') expect(host.textContent).toContain('不受此引擎支持')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally {
    globalThis.fetch = previous
  }
})
it('labels Bergamot downloads separately from shell downloads', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <ul>
          <DownloadItemRow
            item={{
              id: 'preview',
              kind: 'bergamot-pack',
              channel: 'server',
              source: 'en',
              target: 'zh',
              status: 'running',
              phase: 'install',
              receivedBytes: 100,
              totalBytes: 100,
              startedAt: 0,
            }}
          />
        </ul>
      </LocaleProvider>
    )
  )
  expect(host.textContent).toContain('Bergamot · en → zh')
  expect(host.textContent).not.toContain('NW.js')
  expect(host.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false)
})
