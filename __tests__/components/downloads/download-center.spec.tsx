/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DownloadCenter } from '@/components/downloads/DownloadCenter'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { type DownloadItem, requestDownloadCenterOpen, resetDownloadsForTest, upsertDownload } from '@/lib/downloads/store'

let container: HTMLDivElement
let root: Root

const item = (id: string, patch: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  channel: 'server',
  kind: 'nw-shell',
  status: 'running',
  phase: 'download',
  version: 'v0.117.0',
  receivedBytes: 50 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  startedAt: 1,
  ...patch,
})

async function render() {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <DownloadCenter />
        </NotificationProvider>
      </LocaleProvider>
    )
  })
}

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label^="下载管理"]')
const popup = () => document.querySelector('[role="dialog"]')

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }))

beforeEach(() => {
  resetDownloadsForTest()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

test('没有进行中的任务时整块隐藏（已结束的也不显示）', async () => {
  upsertDownload(item('srv:a', { status: 'done' }))
  await render()
  expect(trigger()).toBeNull()
})

test('角标显示进行中任务数；面板只展示信息，没有按钮', async () => {
  upsertDownload(item('srv:a'))
  upsertDownload(item('web:b', { channel: 'browser', gameName: '勇者', phase: 'awaitFile', archiveName: 'nwjs.zip', receivedBytes: undefined }), {
    pickFile: () => {},
    openDownload: () => {},
  })
  upsertDownload(item('srv:old', { status: 'error', error: '旧任务' }))
  await render()
  expect(trigger()!.textContent).toBe('2')
  await click(trigger()!)
  const text = popup()!.textContent!
  expect(text).toContain('NW.js v0.117.0')
  expect(text).toContain('浏览器 · 勇者')
  expect(text).toContain('在游戏卡片点「选择已下载的压缩包」')
  expect(text).toContain('50.0 MB / 200 MB')
  expect(text).not.toContain('旧任务')
  expect(popup()!.querySelectorAll('button')).toHaveLength(0)
})

test('最后一个任务结束后整块隐藏', async () => {
  upsertDownload(item('srv:a'))
  await render()
  expect(trigger()).not.toBeNull()
  await act(async () => upsertDownload(item('srv:a', { status: 'done' })))
  expect(trigger()).toBeNull()
})

test('程序化展开不抢焦点', async () => {
  upsertDownload(item('srv:a'))
  await render()
  const input = document.createElement('input')
  document.body.appendChild(input)
  input.focus()
  await act(async () => requestDownloadCenterOpen())
  expect(popup()).not.toBeNull()
  expect(document.activeElement).toBe(input)
})
