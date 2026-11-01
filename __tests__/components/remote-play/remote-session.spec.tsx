/** @jest-environment jsdom */
import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useRemoteSession } from '@/components/remote-play/useRemoteSession'
import { WebGameLink } from '@/lib/runtime/web-game-link'

jest.mock('@/lib/runtime/web-game-link', () => ({ WebGameLink: jest.fn() }))
jest.mock('@/lib/runtime/remote-play-logger', () => ({
  remotePlayLogger: { info: jest.fn(), warn: jest.fn(), fail: jest.fn(), ok: jest.fn(), add: jest.fn() },
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

type Handlers = ConstructorParameters<typeof WebGameLink>[1]
type FakeLink = {
  roomId: string
  handlers: NonNullable<Handlers>
  start: jest.Mock
  stop: jest.Mock
  send: jest.Mock
  connected: boolean
}

let host: HTMLDivElement
let root: Root
let session: ReturnType<typeof useRemoteSession>
let links: FakeLink[]
let fetchMock: jest.Mock
const games = [
  { id: 'game-1', name: 'First', gameRoot: '/Games/First' },
  { id: 'game-2', name: 'Second', gameRoot: '/Games/Second' },
]
const status = { library: games, selected: games[0].gameRoot, runtime: { gameOnline: true } }
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data }) as Response

function Harness({ room = 'game-1' }: { room?: string }) {
  const current = useRemoteSession(room)
  useLayoutEffect(() => {
    session = current
  })
  return null
}

async function mount(room?: string) {
  await act(async () => root.render(<Harness room={room} />))
}

async function launch() {
  await act(async () => {
    await session.launch()
  })
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  links = []
  jest.mocked(WebGameLink).mockImplementation((roomId, handlers) => {
    const link: FakeLink = {
      roomId,
      handlers: handlers || {},
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
      send: jest.fn(),
      connected: false,
    }
    links.push(link)
    return link as unknown as WebGameLink
  })
  fetchMock = jest.fn((url, init) =>
    Promise.resolve(response(String(url).startsWith('/api/status') ? status : init?.method === 'POST' ? { ok: true, alreadyRunning: true } : { ok: true }))
  )
  globalThis.fetch = fetchMock
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  jest.useRealTimers()
  localStorage.clear()
})

it('requests server host settings instead of a stale per-browser launch mode', async () => {
  localStorage.setItem('chaya:cloud-game:settings', JSON.stringify({ launchMode: 'silent', muteHostAudio: false }))
  await mount()
  await launch()
  const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/launch')!
  expect(JSON.parse(init.body)).toEqual({ remotePlay: true })
})

it('waits for explicit launch even when the game is already online', async () => {
  await mount()
  expect(session.phase).toBe('select')
  expect(links).toHaveLength(0)
  await launch()
  expect(session.phase).toBe('connecting')
  expect(links).toHaveLength(1)
  expect(links[0].start).toHaveBeenCalledWith({ enableMedia: true, takeover: true, role: 'controller' })
})

it.each(['cloud', 'local'])('continues a %s game in its existing room without selecting or launching on the host', async (mode) => {
  const runningGame = { ...games[1], running: { mode, pid: 123, roomId: 'existing-room' } }
  fetchMock.mockImplementation((url) => Promise.resolve(response(String(url).startsWith('/api/status') ? { ...status, library: [games[0], runningGame] } : {})))
  await mount('game-2')
  expect(session.selectedGame?.running?.mode).toBe(mode)
  expect(links).toHaveLength(0)
  await launch()
  expect(links[0].roomId).toBe('existing-room')
  expect(session.roomId).toBe('existing-room')
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    act(() => links[attempt].handlers.onIdle?.())
    await advance(2200)
  }
  act(() => session.reconnect())
  expect(links.at(-1)?.roomId).toBe('existing-room')
})

it('revalidates the process before launching when another player has just started the game', async () => {
  await mount()
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      response(String(url).startsWith('/api/status') ? { ...status, library: [{ ...games[0], running: { mode: 'cloud', pid: 123, roomId: 'game-1' } }, games[1]] } : {})
    )
  )
  await launch()
  expect(links[0].roomId).toBe('game-1')
  expect(session.selectedGame?.running?.mode).toBe('cloud')
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false)
})

it('starts a stopped game when its previous running status is stale', async () => {
  fetchMock.mockResolvedValueOnce(response({ ...status, library: [{ ...games[0], running: { mode: 'local', pid: 123, roomId: 'old-room' } }] }))
  await mount()
  await launch()
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
  expect(links[0].roomId).toBe('game-1')
})

it('only updates client selection when browsing games and never terminates a running host game', async () => {
  await mount()
  await act(async () => {
    await session.selectGame(games[1])
  })
  expect(session.selectedGame?.id).toBe('game-2')
  expect(session.phase).toBe('select')
  expect(links).toHaveLength(0)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false)
})

it('does not connect or launch after cancellation during process revalidation', async () => {
  await mount()
  let resolveSnapshot!: (value: Response) => void
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSnapshot = resolve
      })
  )
  let pending!: Promise<void>
  act(() => {
    pending = session.launch()
  })
  act(() => session.cancel())
  await act(async () => {
    resolveSnapshot(response({ ...status, library: [{ ...games[0], running: { mode: 'local', pid: 123, roomId: 'game-1' } }] }))
    await pending
  })
  expect(session.phase).toBe('select')
  expect(links).toHaveLength(0)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' || init?.method === 'PUT')).toBe(false)
})

it('connects as spectator when an active controller is already present, and allows claiming control', async () => {
  fetchMock.mockImplementation((url, _init) => {
    if (String(url).startsWith('/api/runtime/webrtc')) {
      return Promise.resolve(response({ room: { webConnected: true, updatedAt: Date.now() } }))
    }
    return Promise.resolve(response(String(url).startsWith('/api/status') ? status : { ok: true, alreadyRunning: true }))
  })
  await mount()
  await launch()
  expect(session.isSpectator).toBe(true)
  expect(links[0].start).toHaveBeenCalledWith({ enableMedia: true, takeover: false, role: 'spectator' })

  await act(async () => {
    session.claimControl()
  })
  expect(session.isSpectator).toBe(false)
  expect(links).toHaveLength(2)
  expect(links[1].start).toHaveBeenCalledWith({ enableMedia: true, takeover: true, role: 'controller' })
})

it('launches the URL-selected game instead of silently using the host selection', async () => {
  await mount('game-2')
  await launch()
  const requests = fetchMock.mock.calls
  const selectionIndex = requests.findIndex(([, init]) => init?.method === 'PUT')
  const launchIndex = requests.findIndex(([, init]) => init?.method === 'POST')
  expect(JSON.parse(requests[selectionIndex][1].body)).toEqual({ gameRoot: games[1].gameRoot })
  expect(selectionIndex).toBeLessThan(launchIndex)
  expect(links[0].roomId).toBe('game-2')
})

it('aborts a cancelled launch and ignores its late response', async () => {
  let resolveLaunch!: (value: Response) => void
  fetchMock.mockImplementation((url, init) => {
    if (init?.method === 'POST')
      return new Promise((resolve) => {
        resolveLaunch = resolve
      })
    return Promise.resolve(response(status))
  })
  await mount()
  let pending!: Promise<void>
  await act(async () => {
    pending = session.launch()
  })
  expect(session.phase).toBe('launching')
  const signal = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].signal
  act(() => session.cancel())
  expect(signal.aborted).toBe(true)
  await act(async () => {
    resolveLaunch(response({ ok: true, alreadyRunning: true }))
    await pending
  })
  await advance(60_000)
  expect(session.phase).toBe('select')
  expect(links).toHaveLength(0)
})

it('ignores stale transport events and retry timers after cancelling a connection', async () => {
  await mount()
  await launch()
  const stale = links[0]
  act(() => stale.handlers.onIdle?.())
  expect(session.phase).toBe('reconnecting')
  act(() => session.cancel())
  act(() => {
    stale.handlers.onConnected?.()
    stale.handlers.onDisconnected?.()
  })
  await advance(60_000)
  expect(session.phase).toBe('select')
  expect(session.retryCount).toBe(0)
  expect(links).toHaveLength(1)
})

it('retries exactly three times, deduplicates failures, then requires manual retry', async () => {
  await mount()
  await launch()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const link = links[attempt]
    act(() => {
      link.handlers.onDisconnected?.()
      link.handlers.onIdle?.()
    })
    await advance(2200)
  }
  expect(links).toHaveLength(4)
  expect(session.phase).toBe('failed')
  expect(session.retryCount).toBe(3)
  act(() => session.resume())
  await advance(60_000)
  expect(links).toHaveLength(4)
  act(() => session.reconnect())
  expect(session.phase).toBe('connecting')
  expect(session.retryCount).toBe(0)
  expect(links).toHaveLength(5)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('also caps attempts when the transport never emits an event', async () => {
  await mount()
  await launch()
  await advance(90_000)
  expect(session.phase).toBe('failed')
  expect(links).toHaveLength(4)
})

it('starts a fresh retry budget after a successful connection later drops', async () => {
  await mount()
  await launch()
  act(() => links[0].handlers.onIdle?.())
  await advance(2200)
  act(() => links[1].handlers.onConnected?.())
  expect(session.phase).toBe('connected')
  act(() => links[1].handlers.onDisconnected?.())
  expect(session.retryCount).toBe(1)
  await advance(2200)
  expect(links).toHaveLength(3)
  expect(session.phase).toBe('reconnecting')
})

it('returns to selection on quit and never reconnects from stale callbacks or focus', async () => {
  await mount()
  await launch()
  const stale = links[0]
  act(() => stale.handlers.onConnected?.())
  await act(async () => {
    expect(await session.quit()).toBe(true)
  })
  expect(stale.send).toHaveBeenCalledWith({ type: 'quit' })
  expect(fetchMock).toHaveBeenCalledWith('/api/launch', { method: 'DELETE' })
  act(() => {
    stale.handlers.onDisconnected?.()
    stale.handlers.onConnected?.()
    session.resume()
  })
  await advance(60_000)
  expect(session.phase).toBe('select')
  expect(links).toHaveLength(1)
})

it('switches games without connecting and only launches after explicit user action', async () => {
  await mount()
  await launch()
  const stale = links[0]
  await act(async () => {
    expect(await session.selectGame(games[1])).toBe(true)
  })
  act(() => stale.handlers.onIdle?.())
  await advance(60_000)
  expect(session.phase).toBe('select')
  expect(session.selectedGame?.id).toBe('game-2')
  expect(links).toHaveLength(1)
  await launch()
  expect(links[1].roomId).toBe('game-2')
})

it('does not retry failed launch requests automatically', async () => {
  fetchMock.mockImplementation((url, init) => Promise.resolve(init?.method === 'POST' ? response({ error: 'Unavailable' }, false) : response(status)))
  await mount()
  await launch()
  await advance(60_000)
  expect(session.phase).toBe('failed')
  expect(session.failureKind).toBe('launch')
  expect(links).toHaveLength(0)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  act(() => session.cancel())
  expect(session.phase).toBe('select')
})

it('exposes failure when launch never returns, and ignores a late successful result', async () => {
  let resolveLaunch!: (value: Response) => void
  fetchMock.mockImplementation((url, init) => {
    if (init?.method === 'POST')
      return new Promise((resolve) => {
        resolveLaunch = resolve
      })
    return Promise.resolve(response(status))
  })
  await mount()
  let pending!: Promise<void>
  await act(async () => {
    pending = session.launch()
  })
  await advance(40_000)
  expect(session.phase).toBe('failed')
  expect(session.failureKind).toBe('launch')
  await act(async () => {
    resolveLaunch(response({ alreadyRunning: true }))
    await pending
  })
  expect(links).toHaveLength(0)
})
