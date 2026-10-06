/** @jest-environment jsdom */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LegalNotice } from '@/components/legal/LegalNotice'
import { LegalPage } from '@/components/legal/LegalPage'
import { LOCALES } from '@/lib/i18n/locales'
import { LEGAL_DOC_IDS, LEGAL_DOCS } from '@/lib/legal'
import { DISCLAIMER } from '@/lib/legal/disclaimer'
import { MIT_LICENSE_TEXT } from '@/lib/legal/license'

jest.mock('next/navigation', () => ({ usePathname: () => '/disclaimer', useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

it('every locale covers the same disclaimer sections, including the translation-ban rule', () => {
  const ids = DISCLAIMER.zh.sections.map((section) => section.id)
  expect(ids).toEqual(
    expect.arrayContaining([
      'terms',
      'translation',
      'distribution',
      'third-party',
      'edit',
      'protection',
      'install',
      'software',
      'content',
      'agent',
      'security',
      'privacy',
      'warranty',
      'indemnity',
      'license',
      'rights',
      'misc',
    ])
  )
  for (const locale of LOCALES) {
    expect(DISCLAIMER[locale].sections.map((section) => section.id)).toEqual(ids)
    for (const section of DISCLAIMER[locale].sections) expect(section.items.length).toBeGreaterThan(0)
  }
  expect(DISCLAIMER.zh.sections.find((section) => section.id === 'terms')?.items.join('')).toContain('明确禁止翻译')
  const distribution = DISCLAIMER.zh.sections.find((section) => section.id === 'distribution')?.items.join('')
  expect(distribution).toContain('译文、翻译补丁、翻译缓存')
  expect(distribution).toContain('均属用户的独立行为')
})

it('links to the disclaimer page by default and drops the link inside the game overlay', async () => {
  await act(async () => root.render(<LegalNotice kind="translate" />))
  expect(host.querySelector('[role="note"]')?.textContent).toContain('does not distribute games or translations')
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/disclaimer')

  await act(async () => root.render(<LegalNotice kind="edit" link={false} />))
  expect(host.querySelector('[role="note"]')?.textContent).toContain('back up beforehand')
  expect(host.querySelector('a')).toBeNull()
})

it('renders the full disclaimer in the current locale', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LegalPage id="disclaimer" />
      </LocaleProvider>
    )
  )
  expect(host.querySelector('h1')?.textContent).toBe('免责声明')
  expect(host.querySelectorAll('section')).toHaveLength(DISCLAIMER.zh.sections.length)
  expect(host.textContent).toContain('开发者不提供游戏本体、游戏素材、译文')
})

it('privacy policy and license keep the same sections in every locale', () => {
  for (const id of ['privacy', 'license'] as const) {
    const ids = LEGAL_DOCS[id].content.zh.sections.map((section) => section.id)
    for (const locale of LOCALES) {
      expect(LEGAL_DOCS[id].content[locale].sections.map((section) => section.id)).toEqual(ids)
      for (const section of LEGAL_DOCS[id].content[locale].sections) expect(section.items.length).toBeGreaterThan(0)
    }
  }
  expect(LEGAL_DOCS.privacy.content.zh.sections.map((section) => section.id)).toEqual(
    expect.arrayContaining(['scope', 'local', 'online', 'storage', 'third-party', 'security', 'minors', 'rights', 'changes'])
  )
  const online = LEGAL_DOCS.privacy.content.zh.sections.find((section) => section.id === 'online')?.items.join('')
  expect(online).toContain('Vercel Web Analytics')
  expect(online).toContain('不作持久化存储')
})

it('license page carries the MIT text verbatim from LICENSE', () => {
  expect(MIT_LICENSE_TEXT).toBe(readFileSync(join(process.cwd(), 'LICENSE'), 'utf8'))
  for (const locale of LOCALES) {
    expect(LEGAL_DOCS.license.content[locale].sections.find((section) => section.id === 'mit')?.verbatim).toBe(MIT_LICENSE_TEXT)
  }
})

it('legal pages link to each other', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LegalPage id="privacy" />
      </LocaleProvider>
    )
  )
  expect(host.querySelector('h1')?.textContent).toBe('隐私政策')
  const nav = [...host.querySelectorAll('nav a')]
  expect(nav.map((link) => link.getAttribute('href'))).toEqual(LEGAL_DOC_IDS.map((id) => LEGAL_DOCS[id].href))
  expect(host.querySelector('nav a[aria-current="page"]')?.getAttribute('href')).toBe('/privacy')
})

it('license page also lists the credits', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="en" initialPreference="en">
        <LegalPage id="license" />
      </LocaleProvider>
    )
  )
  expect(host.querySelector('[data-credits]')).not.toBeNull()
  expect(host.textContent).toContain('Font Awesome Free')
})
