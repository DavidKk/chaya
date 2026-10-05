/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: jest.fn() }))

import { useEventsData } from '@/components/game-edit/events/useEventsData'
import { useGameLinkContext } from '@/components/GameLinkProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const send = jest.fn()
const subscribeMessages = jest.fn(() => () => undefined)
const link = { roomId: 'game-a', connected: true }

function Harness() {
  useEventsData({ enabled: true, mapId: null })
  return null
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  send.mockClear()
  subscribeMessages.mockClear()
  link.roomId = 'game-a'
  ;(useGameLinkContext as jest.Mock).mockImplementation(() => ({ ...link, send, subscribeMessages }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('reloads live event data when the connected game room changes', async () => {
  await act(async () => root.render(<Harness />))
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenLastCalledWith({ type: 'edit.events.request' })

  link.roomId = 'game-b'
  await act(async () => root.render(<Harness />))

  expect(send).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenLastCalledWith({ type: 'edit.events.request' })
})
