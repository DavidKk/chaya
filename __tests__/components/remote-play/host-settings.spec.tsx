/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import RemoteSettingsPage from '@/app/remote/settings/page'

jest.mock('@/components/i18n/LocaleProvider', () => ({ useT: () => (key: string) => key }))
jest.mock('@/components/sk', () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
  NumberSliderInput: () => null,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Select: ({ options, onChange, value, disabled, 'aria-label': label }: any) => (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let fetchMock: jest.Mock
const response = (settings: unknown, ok = true) => ({ ok, json: async () => ({ ok, settings }) }) as Response
const modeSelect = () => host.querySelector<HTMLSelectElement>('[aria-label="play.hostSettings.launchMode"]')!

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fetchMock = jest.fn().mockResolvedValue(response({ launchMode: 'silent', muteHostAudio: false }))
  globalThis.fetch = fetchMock
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
})

async function mount() {
  await act(async () => root.render(<RemoteSettingsPage />))
}

async function changeMode(mode: string) {
  await act(async () => {
    modeSelect().value = mode
    modeSelect().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('loads host settings independently of stale browser preferences and saves just the changed field', async () => {
  localStorage.setItem('chaya:cloud-game:settings', JSON.stringify({ launchMode: 'windowed', muteHostAudio: true }))
  await mount()
  expect(modeSelect().value).toBe('silent')
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')

  fetchMock.mockResolvedValueOnce(response({ launchMode: 'windowed', muteHostAudio: false }))
  await changeMode('windowed')
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/remote/settings',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ settings: { launchMode: 'windowed' } }),
    })
  )
  expect(modeSelect().value).toBe('windowed')
})

it('saves the mute switch once per click and preserves the selected launch mode', async () => {
  await mount()
  fetchMock.mockResolvedValueOnce(response({ launchMode: 'silent', muteHostAudio: true }))
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/remote/settings',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ settings: { muteHostAudio: true } }),
    })
  )
  expect(modeSelect().value).toBe('silent')
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
})

it('keeps the last saved value and reports a failed write', async () => {
  await mount()
  fetchMock.mockResolvedValueOnce(response(null, false))
  await changeMode('windowed')
  expect(modeSelect().value).toBe('silent')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('play.hostSettings.saveFailed')
})

it('disables host controls after a failed load and supports retry', async () => {
  fetchMock.mockResolvedValueOnce(response(null, false))
  await mount()
  expect(modeSelect().disabled).toBe(true)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('play.hostSettings.loadFailed')
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
  expect(modeSelect().disabled).toBe(false)
  expect(modeSelect().value).toBe('silent')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
