/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: jest.fn() }))

import { useLinkSaveDataTransport } from '@/components/game-edit/save-data/link-transport'
import { draftStore, valueStore, writtenStore } from '@/components/game-edit/save-data/store'
import { useGameLinkContext } from '@/components/GameLinkProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const link = { roomId: 'game-a' as string | null, connected: true }
const send = jest.fn()
const subscribeMessages = jest.fn(() => () => undefined)

function Harness() {
  useLinkSaveDataTransport(true, async () => undefined)
  return null
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  link.roomId = 'game-a'
  link.connected = true
  send.mockClear()
  subscribeMessages.mockClear()
  ;(useGameLinkContext as jest.Mock).mockImplementation(() => ({ ...link, send, subscribeMessages }))
  valueStore.clear()
  draftStore.clear()
  writtenStore.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function seedSessionState() {
  const key = JSON.stringify(['party', '_gold'])
  valueStore.set(key, { cell: { kind: 'number', value: 100 }, changedAt: 0 })
  draftStore.set(key, { path: ['party', '_gold'], ownerOid: 1, type: 'number', raw: '500', state: 'pending' })
  writtenStore.set(key, true)
  return key
}

test('invalidates page-session data when the linked room changes', async () => {
  await act(async () => root.render(<Harness />))
  const key = seedSessionState()

  link.roomId = 'game-b'
  await act(async () => root.render(<Harness />))

  expect(valueStore.size).toBe(0)
  expect(writtenStore.size).toBe(0)
  expect(draftStore.get(key)?.state).toBe('stale')
})

test('invalidates page-session data when the game disconnects', async () => {
  await act(async () => root.render(<Harness />))
  const key = seedSessionState()

  link.connected = false
  await act(async () => root.render(<Harness />))

  expect(valueStore.size).toBe(0)
  expect(writtenStore.size).toBe(0)
  expect(draftStore.get(key)?.state).toBe('stale')
})

test('invalidates page-session data when the room changes while the page is unmounted', async () => {
  await act(async () => root.render(<Harness />))
  const key = seedSessionState()
  await act(async () => root.render(null))

  link.roomId = 'game-b'
  await act(async () => root.render(<Harness />))

  expect(valueStore.size).toBe(0)
  expect(writtenStore.size).toBe(0)
  expect(draftStore.get(key)?.state).toBe('stale')
})
