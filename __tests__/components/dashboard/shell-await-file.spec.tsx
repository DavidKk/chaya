/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ShellAwaitFile } from '@/components/dashboard/ShellAwaitFile'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { resetDownloadsForTest, upsertDownload } from '@/lib/downloads/store'

let container: HTMLDivElement
let root: Root

async function render(gameId: string) {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <ShellAwaitFile gameId={gameId} buttonClassName="" />
        </NotificationProvider>
      </LocaleProvider>
    )
  })
}

const buttons = () => [...container.querySelectorAll('button')]

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
})

test('只有当前游戏的装壳任务在等待选文件时显示两步', async () => {
  const pickFile = jest.fn()
  const openDownload = jest.fn()
  upsertDownload(
    { id: 'web:1', channel: 'browser', kind: 'nw-shell', status: 'running', phase: 'awaitFile', gameId: 'g1', archiveName: 'nwjs-win-x64.zip', startedAt: 1 },
    { pickFile, openDownload }
  )

  await render('g2')
  expect(buttons()).toHaveLength(0)

  await render('g1')
  expect(container.textContent).toContain('nwjs-win-x64.zip')
  expect(buttons().map((b) => b.textContent)).toEqual(['选择已下载的压缩包', '打开官方下载'])
  await act(async () => buttons()[0].click())
  await act(async () => buttons()[1].click())
  expect(pickFile).toHaveBeenCalled()
  expect(openDownload).toHaveBeenCalled()
})

test('任务进入读写阶段后不再显示', async () => {
  upsertDownload({ id: 'web:1', channel: 'browser', kind: 'nw-shell', status: 'running', phase: 'read', gameId: 'g1', startedAt: 1 }, {})
  await render('g1')
  expect(buttons()).toHaveLength(0)
})
