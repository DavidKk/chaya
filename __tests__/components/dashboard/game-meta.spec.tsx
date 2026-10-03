/** @jest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DashboardGameMeta } from '@/components/dashboard/DashboardGameMeta'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

type MetaProps = ComponentProps<typeof DashboardGameMeta>

let host: HTMLDivElement
let root: Root

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

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

const base: MetaProps['status'] = {
  ready: true,
  canUseDisk: true,
  config: { gameRoot: '/games/demo', shellSource: '' },
  library: [],
  contentRoot: 'www',
  projectRoot: 'demo',
  kind: 'www',
  hasShell: true,
  bundled: false,
  nestedInApp: false,
  cache: { entries: 4461 },
  plugins: [],
  pluginsReady: 5,
  pluginsTotal: 5,
}

async function render(props: Partial<MetaProps> & { status: MetaProps['status'] }) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <DashboardGameMeta remote={false} layoutLabel="www" online={false} pending={false} {...props} />
      </LocaleProvider>
    )
  )
  const row = host.firstElementChild as HTMLElement
  return {
    texts: [...row.querySelectorAll(':scope > span:not([aria-hidden]) > span, :scope > span:not([aria-hidden]):last-child')].map((el) => el.textContent?.trim()),
    separators: row.querySelectorAll(':scope > span[aria-hidden]').length,
    last: row.lastElementChild?.textContent?.trim(),
  }
}

test('本机：游戏｜运行环境｜数据 三组，壳显示体积，连接状态收尾', async () => {
  const meta = await render({
    status: { ...base, footprint: { contentLabel: '3.33 GB', shellLabel: '398 MB' } } as MetaProps['status'],
    win: { width: 1380, height: 799 },
  })
  expect(meta.texts).toEqual(['www', '3.33 GB', '398 MB', '1380×799', '5/5', '4,461', '未连接'])
  expect(meta.separators).toBe(2)
  expect(meta.last).toBe('未连接')
})

test('体积未测完 / 无窗口 / 无共享译文：缺项隐藏，壳显示状态', async () => {
  const meta = await render({ status: { ...base, canUseDisk: false, cache: { entries: 0 } }, win: null })
  expect(meta.texts).toEqual(['www', '已装壳', '5/5', '未连接'])
  expect(meta.separators).toBe(1)
})

test('未装壳时显示状态而不是体积', async () => {
  const meta = await render({ status: { ...base, hasShell: false, footprint: { contentLabel: '3.33 GB', shellLabel: '398 MB' } } as MetaProps['status'] })
  expect(meta.texts).toContain('未装壳')
  expect(meta.texts).not.toContain('398 MB')
})
