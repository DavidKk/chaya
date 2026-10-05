/** @jest-environment jsdom */
import { act, createRef, forwardRef, useImperativeHandle, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { emptySession, type SessionState } from '@/components/game-edit'

jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: jest.fn() }))

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useGameEditLinkSync } from '@/hooks/useGameEditLinkSync'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const send = jest.fn()
const subscribeMessages = jest.fn(() => () => undefined)
const acquireEditSession = jest.fn(() => () => undefined)
const link = { roomId: 'game-a', connected: true }
type Sync = ReturnType<typeof useGameEditLinkSync>
const syncRef = createRef<Sync>()

const Harness = forwardRef<Sync>(function Harness(_props, ref) {
  const [, setSession] = useState<SessionState>(emptySession)
  const sync = useGameEditLinkSync(setSession, jest.fn())
  useImperativeHandle(ref, () => sync, [sync])
  return null
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  jest.useFakeTimers()
  send.mockClear()
  subscribeMessages.mockClear()
  acquireEditSession.mockClear()
  link.roomId = 'game-a'
  link.connected = true
  ;(useGameLinkContext as jest.Mock).mockImplementation(() => ({ ...link, send, subscribeMessages, acquireEditSession }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  jest.useRealTimers()
})

test('stops retrying a command after the give-up deadline', async () => {
  await act(async () => root.render(<Harness ref={syncRef} />))
  const operation = syncRef.current!.runCmd({ op: 'commonEvent', id: 3 })
  const rejection = expect(operation).rejects.toThrow('游戏无响应')

  await act(async () => jest.advanceTimersByTime(8_000))
  await rejection
  const sendsAtDeadline = send.mock.calls.length

  await act(async () => jest.advanceTimersByTime(10_000))
  expect(send).toHaveBeenCalledTimes(sendsAtDeadline)
})

test('rejects an in-flight command as soon as the game disconnects', async () => {
  await act(async () => root.render(<Harness ref={syncRef} />))
  const operation = syncRef.current!.runCmd({ op: 'commonEvent', id: 3 })
  const rejection = expect(operation).rejects.toThrow('游戏连接已断开')

  link.connected = false
  await act(async () => root.render(<Harness ref={syncRef} />))

  await rejection
})
