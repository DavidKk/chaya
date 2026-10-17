/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LogsSectionView } from '@/components/logs/LogsSectionView'
import { LogsShell } from '@/components/logs/LogsShell'

const replace = jest.fn()
let pathname = '/logs/runtime'
let params: { section?: string } = { section: 'runtime' }
let query = new URLSearchParams()

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
  useSearchParams: () => query,
  useParams: () => params,
}))

jest.mock('@/components/LogPanel', () => ({ LogPanel: () => <div data-testid="runtime-log">runtime</div> }))
jest.mock('@/components/game-agent/AgentActivityLogPanel', () => ({
  AgentActivityLogPanel: ({ selection, onSelectionChange }: { selection: string; onSelectionChange: (taskId: string) => void }) => (
    <button type="button" data-testid="agent-log" data-selection={selection} onClick={() => onSelectionChange('task-next')}>
      agent
    </button>
  ),
}))
jest.mock('@/components/game-agent/AgentCliProcessesPanel', () => ({
  AgentCliProcessesPanel: () => <div data-testid="cli-processes">cli</div>,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  replace.mockClear()
  pathname = '/logs/runtime'
  params = { section: 'runtime' }
  query = new URLSearchParams()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('uses slash secondary links in the section sidebar', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogsShell>
          <LogsSectionView />
        </LogsShell>
      </LocaleProvider>
    )
  )

  const aside = host.querySelector<HTMLElement>('[data-section-side-nav]')!
  const links = Array.from(aside.querySelectorAll<HTMLAnchorElement>('a'))
  expect(aside.getAttribute('data-mobile-visible')).toBeNull()
  expect(aside.className).toContain('hidden')
  expect(aside.className).toContain('md:block')
  expect(links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
    ['运行日志', '/logs/runtime'],
    ['Agent 活动', '/logs/agent'],
    ['Agent 进程', '/logs/cli'],
  ])
  expect(links[0].getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('[data-testid="runtime-log"]')).not.toBeNull()
})

test('selects Agent activity from the path and keeps taskId as query', async () => {
  pathname = '/logs/agent'
  params = { section: 'agent' }
  query = new URLSearchParams('taskId=task-current')
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogsShell>
          <LogsSectionView />
        </LogsShell>
      </LocaleProvider>
    )
  )

  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-section-side-nav] a'))
  expect(links[1].getAttribute('aria-current')).toBe('page')
  const agentLog = host.querySelector<HTMLButtonElement>('[data-testid="agent-log"]')!
  expect(agentLog.dataset.selection).toBe('task-current')

  await act(async () => agentLog.click())
  expect(replace).toHaveBeenCalledWith('/logs/agent?taskId=task-next', { scroll: false })
})

test('selects Agent processes from the path', async () => {
  pathname = '/logs/cli'
  params = { section: 'cli' }
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogsShell>
          <LogsSectionView />
        </LogsShell>
      </LocaleProvider>
    )
  )
  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-section-side-nav] a'))
  expect(links[2].getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('[data-testid="cli-processes"]')).not.toBeNull()
})
