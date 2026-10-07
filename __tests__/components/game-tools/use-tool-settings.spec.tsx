/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let state: ReturnType<typeof useToolSettings>

function Probe({ request }: { request: GameAgentRequest }) {
  const value = useToolSettings(request)
  useEffect(() => {
    state = value
  })
  return null
}

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

it('is not loaded until the first request settles', async () => {
  let resolve!: (response: Response) => void
  const request: GameAgentRequest = () => new Promise((done) => (resolve = done))
  await act(async () => root.render(<Probe request={request} />))
  expect(state.loaded).toBe(false)
  await act(async () => resolve({ ok: true, json: async () => ({ settings: { companionEnabled: true } }) } as Response))
  expect(state.loaded).toBe(true)
  expect(state.settings.companionEnabled).toBe(true)
})

it('finishes loading with an error when the request throws synchronously', async () => {
  const request: GameAgentRequest = () => {
    throw new Error('游戏未连接')
  }
  await act(async () => root.render(<Probe request={request} />))
  expect(state.loaded).toBe(true)
  expect(state.error).toBe('游戏未连接')
})
