/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameEditPaneSkeleton } from '@/components/game-edit/GameEditPaneSkeleton'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateCacheOptimizeSkeleton } from '@/components/translate/TranslateCacheOptimizeSkeleton'
import { TranslateCachePageSkeleton } from '@/components/translate/TranslateCachePageSkeleton'
import { TranslateEnginesSkeleton } from '@/components/translate/TranslateEnginesSkeleton'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslateTestSkeleton } from '@/components/translate/TranslateTestSkeleton'

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
  return root.render(
    <LocaleProvider initialLocale="zh" initialPreference="zh">
      {node}
    </LocaleProvider>
  )
}

test('日志懒加载使用筛选头、四字段列表和页脚骨架', async () => {
  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="logs" />))

  expect(host.querySelector('[aria-label="加载日志面板"]')).not.toBeNull()
  expect(host.querySelectorAll('[data-list-heading]')).toHaveLength(4)
  expect(host.querySelector('[class*="border-t"][class*="justify-between"]')).not.toBeNull()
})

test('局内翻译骨架跟随运行与翻译库分区', async () => {
  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="trans" translateSection="seed" translateTab="seed" />))
  expect(host.querySelector('[aria-label="加载翻译面板"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载原文翻译进度"]')).not.toBeNull()
  expect(host.querySelector('table')).toBeNull()

  await act(async () => renderWithLocale(<GameEditPaneSkeleton tab="trans" translateSection="cache" />))
  expect(host.querySelector('[aria-label="加载本作翻译库"]')).not.toBeNull()
  const grid = host.querySelector<HTMLElement>('[role="presentation"] > .grid')!
  expect(grid.children).toHaveLength(8)
  expect(grid.style.gridTemplateColumns).toContain('minmax(10rem,1fr)')
})

test('游玩与 Seed 使用各自内容骨架', async () => {
  await act(async () => renderWithLocale(<TranslateRunSkeleton tab="play" />))
  expect(host.querySelector('[aria-label="加载游玩翻译设置"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载翻译活动日志"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载原文翻译进度"]')).toBeNull()

  await act(async () => renderWithLocale(<TranslateRunSkeleton tab="seed" />))
  expect(host.querySelector('[aria-label="加载原文翻译进度"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载翻译活动日志"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="加载游玩翻译设置"]')).toBeNull()
})

test('翻译列表骨架保留筛选、条目行与分页页脚', async () => {
  await act(async () => renderWithLocale(<TranslateRunSkeleton tab="list" />))

  expect(host.querySelector('[aria-label="加载翻译列表"]')).not.toBeNull()
  expect(host.querySelectorAll('.h-\\[150px\\]')).toHaveLength(4)
  expect(host.querySelectorAll('.border-b.border-line.bg-surface\\/10')).toHaveLength(1)
})

test('翻译工具骨架区分三卡总览与单卡详情', async () => {
  await act(async () => renderWithLocale(<TranslateEnginesSkeleton />))
  expect(host.querySelector('[aria-label="加载翻译工具"]')).not.toBeNull()
  expect(host.querySelectorAll('section')).toHaveLength(3)

  await act(async () => renderWithLocale(<TranslateEnginesSkeleton view="detail" />))
  expect(host.querySelector('[aria-label="加载翻译工具详情"]')).not.toBeNull()
  expect(host.querySelectorAll('section')).toHaveLength(1)
})

test('翻译库、缓存详情和缓存测试使用各自页面骨架', async () => {
  await act(async () => renderWithLocale(<TranslateCachePageSkeleton />))
  expect(host.querySelector('[aria-label="加载本作翻译库"]')).not.toBeNull()
  expect(host.querySelectorAll('[role="presentation"] > .grid:first-child > div')).toHaveLength(8)

  await act(async () => renderWithLocale(<TranslateCacheOptimizeSkeleton />))
  expect(host.querySelector('[aria-label="加载翻译库详情"]')).not.toBeNull()
  expect(host.querySelectorAll('section')).toHaveLength(3)

  await act(async () => renderWithLocale(<TranslateTestSkeleton />))
  expect(host.querySelector('[aria-label="加载缓存测试"]')).not.toBeNull()
  expect(host.querySelectorAll('section')).toHaveLength(2)
})
