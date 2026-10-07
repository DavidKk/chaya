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

it('runs saves one after another so quick clicks keep each other’s changes', async () => {
  const puts: Array<{ body: Record<string, unknown>; done: () => void }> = []
  let server: Record<string, unknown> = {}
  const request: GameAgentRequest = (_path, init) => {
    if (init?.method !== 'PUT') return Promise.resolve({ ok: true, json: async () => ({ settings: server }) } as Response)
    const body = JSON.parse(String(init.body)).settings
    return new Promise((resolve) =>
      puts.push({
        body,
        done: () => {
          server = body
          resolve({ ok: true, json: async () => ({ settings: body }) } as Response)
        },
      })
    )
  }
  await act(async () => root.render(<Probe request={request} />))
  let first!: Promise<void>
  let second!: Promise<void>
  await act(async () => {
    first = state.update({ miniMapEnabled: true })
    second = state.update((current) => ({ panelDockHiddenItems: [...current.panelDockHiddenItems, 'closeAll'] }))
  })
  expect(puts).toHaveLength(1)
  await act(async () => {
    puts[0].done()
    await first
  })
  expect(puts[1].body).toMatchObject({ miniMapEnabled: true, panelDockHiddenItems: ['closeAll'] })
  await act(async () => {
    puts[1].done()
    await second
  })
  expect(state.settings).toMatchObject({ miniMapEnabled: true, panelDockHiddenItems: ['closeAll'] })
})

it('drops a read that started before a save finished, so it cannot roll the cache back', async () => {
  let resolveGet!: (response: Response) => void
  let server: Record<string, unknown> = {}
  let gets = 0
  const request: GameAgentRequest = (_path, init) => {
    if (init?.method === 'PUT') {
      server = JSON.parse(String(init.body)).settings
      return Promise.resolve({ ok: true, json: async () => ({ settings: server }) } as Response)
    }
    if (gets++ === 0) return new Promise((done) => (resolveGet = done))
    return Promise.resolve({ ok: true, json: async () => ({ settings: server }) } as Response)
  }
  await act(async () => root.render(<Probe request={request} />))
  await act(async () => state.update({ miniMapEnabled: true }))
  await act(async () => resolveGet({ ok: true, json: async () => ({ settings: { miniMapEnabled: false } }) } as Response))
  expect(state.settings.miniMapEnabled).toBe(true)
  expect(state.loaded).toBe(true)
})

it('merges into the latest server value so another window’s change is kept', async () => {
  let server: Record<string, unknown> = {}
  const request: GameAgentRequest = async (_path, init) => {
    if (init?.method === 'PUT') server = JSON.parse(String(init.body)).settings
    return { ok: true, json: async () => ({ settings: server }) } as Response
  }
  await act(async () => root.render(<Probe request={request} />))
  server = { ...server, panelDockOrientation: 'vertical' }
  await act(async () => state.update({ miniMapEnabled: true }))
  expect(server).toMatchObject({ miniMapEnabled: true, panelDockOrientation: 'vertical' })
})

it('treats only a missing endpoint as unavailable', async () => {
  const request: GameAgentRequest = async () => ({ ok: false, status: 404 }) as Response
  await act(async () => root.render(<Probe request={request} />))
  expect(state.unavailable).toBe(true)
})
