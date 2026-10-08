/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useGameSaves } from '@/components/game-saves/useGameSaves'
import { type GameToolTransport, GameToolTransportContext } from '@/components/game-tools/transport'
import { parseGameSavesSettings } from '@/lib/game/game-saves'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { GameSavesController } from '@/plugins/src/cheat/game-saves/controller'
import type { GameSavesEnv } from '@/plugins/src/cheat/game-saves/env'
import { createMemoryBackend } from '@/plugins/src/cheat/game-saves/store'

jest.mock('@/plugins/src/helpers/node/node-require', () => ({ tryNodeFsPath: () => null, tryNodeRequire: () => require }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
if (!globalThis.crypto?.randomUUID) {
  let n = 0
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => `id-${++n}` } })
}

const game = { state: 'A' }

function makeController() {
  const env: GameSavesEnv = {
    backend: createMemoryBackend(),
    appStore: createMemoryBackend(),
    gameId: () => 'g1',
    now: () => Date.now(),
    frames: () => 0,
    active: () => true,
    safety: () => ({ ok: true }),
    inGame: () => true,
    fingerprint: () => 'f',
    versionId: () => 1,
    capture: () => ({ json: JSON.stringify(game), meta: { playtimeFrames: 0, mapId: 1, mapName: '村庄', partyNames: [], versionId: 1, engine: 'mv' } }),
    restore: (json) => Object.assign(game, JSON.parse(json)),
    thumb: () => null,
    toast: { pending: () => {}, result: () => {} },
    beforeLoad: () => {},
    afterLoad: () => {},
    log: { info: () => {}, warn: () => {}, fail: () => {} },
    onActivity: () => () => {},
  }
  return new GameSavesController(env)
}

function makeTransport(controller: GameSavesController, connected = true): GameToolTransport {
  const listeners = new Set<(m: GameLinkMessage) => void>()
  return {
    roomId: 'g1',
    connected,
    negotiating: false,
    localGlobal: true,
    send: (message) => controller.request(message, (reply) => queueMicrotask(() => listeners.forEach((l) => l(reply)))),
    subscribeMessages: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
}

let host: HTMLDivElement
let root: Root
let state: ReturnType<typeof useGameSaves>

function Probe() {
  const value = useGameSaves()
  useEffect(() => {
    state = value
  })
  return null
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}

beforeEach(() => {
  localStorage.clear()
  game.state = 'A'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function mount(transport: GameToolTransport) {
  await act(async () =>
    root.render(
      <GameToolTransportContext.Provider value={transport}>
        <Probe />
      </GameToolTransportContext.Provider>
    )
  )
  await flush()
}

it('loads the snapshot once connected and runs save / load commands', async () => {
  await mount(makeTransport(makeController()))
  expect(state.ready).toBe(true)
  expect(state.snapshot?.index.entries).toEqual([])

  await act(async () => state.saveSettings({ quickEnabled: true }))
  await act(async () => void (await state.command({ op: 'save', target: 'quick', slot: 2 })))
  expect(state.snapshot?.index.entries.map((e) => e.id)).toEqual(['quick-2'])

  game.state = 'B'
  await act(async () => void (await state.command({ op: 'load', entryId: 'quick-2' })))
  expect(game.state).toBe('A')
})

it('saves settings locally and pushes them to the game with a newer revision', async () => {
  const controller = makeController()
  await mount(makeTransport(controller))
  await act(async () => state.saveSettings({ enabled: true, intervalMin: 10 }))
  expect(parseGameSavesSettings(JSON.parse(localStorage.getItem('chaya:game-saves:settings')!))).toMatchObject({ enabled: true, intervalMin: 10, revision: 1 })
  expect(controller.snapshot().settings).toMatchObject({ enabled: true, intervalMin: 10, revision: 1 })
})

it('replays a settings change on top of a newer game-side revision instead of diverging', async () => {
  const controller = makeController()
  await mount(makeTransport(controller))
  const other = { ...parseGameSavesSettings(null), intervalMin: 30, revision: 1 }
  await new Promise<void>((resolve) =>
    controller.request({ type: 'saves.cmd', reqId: 'other', gameId: 'g1', op: 'configure', settings: other, expectedRevision: 0 }, () => resolve())
  )
  await act(async () => state.saveSettings({ enabled: true }))
  expect(controller.snapshot().settings).toMatchObject({ enabled: true, intervalMin: 30, revision: 2 })
  expect(state.settings).toMatchObject({ enabled: true, intervalMin: 30, revision: 2 })
})

it('surfaces a non-stale configure failure without replaying the change', async () => {
  const controller = makeController()
  await mount(makeTransport(controller))
  const backend = (controller as unknown as { env: GameSavesEnv }).env.backend
  backend.writeSettings = async () => {
    throw new Error('disk full')
  }
  let failure: unknown
  await act(async () => {
    failure = await state.saveSettings({ enabled: true }).catch((cause) => cause)
  })
  expect(failure).toEqual(expect.objectContaining({ code: 'failed' }))
  expect(state.settings.revision).toBe(1)
  expect(parseGameSavesSettings(JSON.parse(localStorage.getItem('chaya:game-saves:settings')!)).revision).toBe(1)
})

it('sends newer local settings to the game when it connects', async () => {
  localStorage.setItem('chaya:game-saves:settings', JSON.stringify({ ...parseGameSavesSettings(null), enabled: true, revision: 4 }))
  const controller = makeController()
  await mount(makeTransport(controller))
  expect(controller.snapshot().settings).toMatchObject({ enabled: true, revision: 4 })
})

it('rejects commands while disconnected', async () => {
  await mount(makeTransport(makeController(), false))
  expect(state.ready).toBe(false)
  await expect(state.command({ op: 'snapshot' })).rejects.toThrow()
})
