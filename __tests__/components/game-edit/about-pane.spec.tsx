/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameEditAboutPane } from '@/components/game-edit/GameEditAboutPane'
import { EDIT_TABS, isEditTab } from '@/components/game-edit/tabs'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { GITHUB_URL, PRODUCT_VERSION } from '@/lib/about'
import { CREDIT_GROUPS } from '@/lib/credits'
import { MIT_LICENSE_TEXT } from '@/lib/legal/license'

jest.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type NwHost = typeof globalThis & { nw?: { Shell: { openExternal: jest.Mock } } }

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete (globalThis as NwHost).nw
})

async function renderPane() {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditAboutPane />
      </LocaleProvider>
    )
  })
}

it('about is a main page, not an edit sub tab', () => {
  expect(isEditTab('about')).toBe(false)
  expect(EDIT_TABS.some((tab) => tab.id === 'about')).toBe(false)
})

it('intro shows version, usage and opens links outside the game window', async () => {
  const openExternal = jest.fn()
  ;(globalThis as NwHost).nw = { Shell: { openExternal } }
  await renderPane()

  expect(host.querySelector('h1')?.textContent).toContain(PRODUCT_VERSION)
  expect(host.textContent).toContain('使用方式')
  expect(host.textContent).toContain('开源 · MIT')
  expect(GITHUB_URL).toMatch(/^https:\/\/github\.com\/.+/)

  await act(async () => host.querySelector<HTMLButtonElement>('[data-about-link="github"]')?.click())
  expect(openExternal).toHaveBeenCalledWith(GITHUB_URL)
  expect(host.querySelector('a')).toBeNull()
})

it('second section renders the full disclaimer', async () => {
  await renderPane()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="免责声明"]')?.click())

  expect(host.querySelector('h1')?.textContent).toBe('免责声明')
  expect(host.textContent).toContain('不提供任何形式的分发')
})

it('privacy and license sections render their documents', async () => {
  await renderPane()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="隐私政策"]')?.click())
  expect(host.querySelector('h1')?.textContent).toBe('隐私政策')

  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="开源许可"]')?.click())
  expect(host.querySelector('h1')?.textContent).toBe('开源许可')
  expect(host.querySelector('pre')?.textContent).toBe(MIT_LICENSE_TEXT)
})

it('credits list the major tools with licenses and attribute CC BY assets', async () => {
  const credits = CREDIT_GROUPS.flatMap((group) => group.items)
  for (const item of credits) {
    expect(item.url).toMatch(/^https:\/\//)
    if (item.license.startsWith('CC-BY')) expect(item.author).toBeTruthy()
  }
  expect(credits.map((item) => item.name)).toEqual(expect.arrayContaining(['NW.js', 'Next.js', 'React', 'kuromoji.js', 'Ollama', 'Game-icons.net']))

  const openExternal = jest.fn()
  ;(globalThis as NwHost).nw = { Shell: { openExternal } }
  await renderPane()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="致谢"]')?.click())

  expect(host.querySelector('h1')?.textContent).toBe('致谢')
  expect(host.querySelectorAll('[data-credits] h3')).toHaveLength(CREDIT_GROUPS.length)
  expect(host.textContent).toContain('CC-BY-3.0')
  expect(host.textContent).toContain('Lorc, Delapouite et al.')
  expect(host.textContent).toContain('感谢名单')

  await act(async () => host.querySelector<HTMLButtonElement>('[data-credit="Next.js"]')?.click())
  expect(openExternal).toHaveBeenCalledWith('https://nextjs.org')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-credit="contributors"]')?.click())
  expect(openExternal).toHaveBeenLastCalledWith(expect.stringMatching(/\/graphs\/contributors$/))
})
