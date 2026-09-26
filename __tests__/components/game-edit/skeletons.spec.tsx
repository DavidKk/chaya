/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameEditPaneSkeleton } from '@/components/game-edit/GameEditPaneSkeleton'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'

jest.mock('next/navigation', () => ({
  usePathname: () => '/cheat/run',
  useRouter: () => ({ push: jest.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function renderWithLocale(node: ReactNode) {
  return root.render(<LocaleProvider initialLocale="zh">{node}</LocaleProvider>)
}

test('日志懒加载使用筛选头、四列表格和页脚骨架', async () => {
  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="logs" />))

  expect(host.querySelector('[aria-label="加载日志面板"]')).not.toBeNull()
  expect(host.querySelectorAll('thead th')).toHaveLength(4)
  expect(host.querySelector('[class*="border-t"][class*="justify-between"]')).not.toBeNull()
})

test('局内翻译骨架跟随运行与翻译库分区', async () => {
  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="trans" translateSection="run" translateTab="seed" />))
  expect(host.querySelector('[aria-label="加载翻译面板"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载 Seed 翻译进度"]')).not.toBeNull()
  expect(host.querySelector('table')).toBeNull()

  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="trans" translateSection="cache" />))
  expect(host.querySelector('[aria-label="加载本作翻译库"]')).not.toBeNull()
  const columns = [...host.querySelectorAll<HTMLTableCellElement>('thead th')]
  expect(columns).toHaveLength(6)
  expect(columns.map((column) => column.style.width)).toEqual(['34%', '34%', '7rem', '4.5rem', '10rem', '7.5rem'])
})

test('游玩与 Seed 使用各自内容骨架', async () => {
  await act(async () => renderWithLocale(<TranslateRunSkeleton tab="play" />))
  expect(host.querySelector('[aria-label="加载游玩翻译设置"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载翻译活动日志"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载 Seed 翻译进度"]')).toBeNull()

  await act(async () => renderWithLocale(<TranslateRunSkeleton tab="seed" />))
  expect(host.querySelector('[aria-label="加载 Seed 翻译进度"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载游玩翻译设置"]')).toBeNull()
})
