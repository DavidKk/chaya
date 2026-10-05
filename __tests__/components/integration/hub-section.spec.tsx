/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { editMapHref } from '@/components/game-edit/tabs'
import { type HubRoute, useHubSection } from '@/components/integration/hub-section'
import { readViewState } from '@/lib/view-state'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function Probe({ route }: { route?: HubRoute }) {
  const { section, navTo } = useHubSection(route, 'test.section')
  const target = navTo('edit')
  return target.href ? (
    <a href={target.href}>{section || 'overview'}</a>
  ) : (
    <button type="button" onClick={target.onSelect}>
      {section || 'overview'}
    </button>
  )
}

test('web pages read the section from the route and link to group URLs', async () => {
  await act(async () => root.render(<Probe route={{ base: '/integration/mcp', section: 'live' }} />))
  const link = host.querySelector('a')!
  expect(link.textContent).toBe('live')
  expect(link.getAttribute('href')).toBe('/integration/mcp/edit')
})

test('without a route the section survives a remount (overlay refresh)', async () => {
  await act(async () => root.render(<Probe />))
  await act(async () => host.querySelector('button')!.click())
  expect(readViewState('test.section')).toBe('edit')

  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<Probe />))
  expect(host.textContent).toBe('edit')
})

test('map event URLs carry the 1-based page tab', () => {
  expect(editMapHref(3, 14, 2)).toBe('/cheat/map/3/14/2')
  expect(editMapHref(3, 14)).toBe('/cheat/map/3/14')
  expect(editMapHref(3, null, 2)).toBe('/cheat/map/3')
})
