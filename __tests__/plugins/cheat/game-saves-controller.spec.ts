/** @jest-environment jsdom */
import { newAutoEntryId, parseGameSavesSettings, type SaveWaitReason } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'
import type { GameLinkMessage, GameSavesMessage } from '@/lib/runtime/game-link-protocol'
import { GameSavesController } from '@/plugins/src/cheat/game-saves/controller'
import type { GameSavesEnv } from '@/plugins/src/cheat/game-saves/env'
import { GAME_SAVES_CHANGED_EVENT } from '@/plugins/src/cheat/game-saves/events'
import { createMemoryBackend, type GameSaveEntryStore, gunzipText } from '@/plugins/src/cheat/game-saves/store'

jest.mock('@/plugins/src/helpers/node/node-require', () => ({ tryNodeFsPath: () => null, tryNodeRequire: () => require }))

type Reply = Extract<GameSavesMessage, { type: 'saves.reply' }>

function setup({ quickEnabled = true, appStore = createMemoryBackend() as GameSaveEntryStore } = {}) {
  const backend = createMemoryBackend()
  void backend.writeSettings({ ...parseGameSavesSettings(null), quickEnabled })
  const game = { state: 'A', frames: 0, saveCount: 7, inGame: true, active: true, unsafe: null as SaveWaitReason | null, fingerprint: 'm1', failRestore: false }
  const toasts: string[] = []
  const calls: string[] = []
  let activity: () => void = () => {}
  let now = 1_000
  const env: GameSavesEnv = {
    backend,
    appStore,
    gameId: () => 'g1',
    now: () => (now += 10),
    frames: () => game.frames,
    active: () => game.active,
    safety: () => (game.unsafe ? { ok: false, reason: game.unsafe } : { ok: true }),
    inGame: () => game.inGame,
    fingerprint: () => game.fingerprint,
    versionId: () => 1,
    capture: () => ({ json: JSON.stringify({ state: game.state }), meta: { playtimeFrames: game.frames, mapId: 1, mapName: '村庄', partyNames: [], versionId: 1, engine: 'mv' } }),
    restore: (json) => {
      const parsed = JSON.parse(json) as { state: string }
      if (game.failRestore && parsed.state !== 'A') throw new Error('broken')
      game.state = parsed.state
    },
    thumb: () => 'data:image/jpeg;base64,AA==',
    toast: { pending: (l) => toasts.push(`…${l}`), result: (k, l) => toasts.push(`${k === 'success' ? '✓' : '×'}${l}`) },
    beforeLoad: () => calls.push('beforeLoad'),
    afterLoad: () => calls.push('afterLoad'),
    log: { info: () => {}, warn: () => {}, fail: () => {} },
    onActivity: (handler) => {
      activity = handler
      return () => {}
    },
  }
  const controller = new GameSavesController(env)
  let seq = 0
  const send = (op: Record<string, unknown>): Promise<Reply> =>
    new Promise((resolve) => {
      controller.request({ type: 'saves.cmd', reqId: `r${++seq}`, gameId: 'g1', ...op } as GameLinkMessage, (message) => {
        if (message.type === 'saves.reply') resolve(message)
      })
    })
  const okSnapshot = async (op: Record<string, unknown>) => {
    const reply = await send(op)
    if (!reply.ok) throw new Error(reply.error)
    return reply.snapshot
  }
  return { controller, backend, appStore, game, toasts, calls, send, okSnapshot, input: () => activity() }
}

afterEach(() => jest.useRealTimers())

it('appends manual saves to the auto list and rotates the oldest out', async () => {
  const { okSnapshot } = setup()
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), maxCount: 15 }, expectedRevision: 0 })
  let snapshot = await okSnapshot({ op: 'snapshot' })
  for (let i = 0; i < 16; i++) snapshot = await okSnapshot({ op: 'save', target: 'auto' })
  const auto = snapshot.index.entries.filter((e) => e.list === 'auto')
  expect(auto).toHaveLength(15)
  expect(auto.every((e) => e.tag === 'manual')).toBe(true)
})

it('refuses an unsafe page save until forced, then marks it', async () => {
  const { send, okSnapshot, game, toasts } = setup()
  game.unsafe = 'battle'
  const refused = await send({ op: 'save', target: 'quick', slot: 3 })
  expect(refused).toEqual(expect.objectContaining({ ok: false, code: 'unsafe', reason: 'battle' }))
  expect(toasts).toEqual([])
  const snapshot = await okSnapshot({ op: 'save', target: 'quick', slot: 3, force: true })
  expect(snapshot.index.entries).toEqual([expect.objectContaining({ id: 'quick-3', slot: 3, unsafe: true })])
})

it('quick save hotkey shows the reason in game and keeps the slot untouched when unsafe', async () => {
  const { controller, okSnapshot, game, toasts } = setup()
  await okSnapshot({ op: 'save', target: 'quick', slot: 3 })
  game.unsafe = 'battle'
  game.state = 'B'
  controller.hotkey('save', 3)
  await new Promise((r) => setTimeout(r, 0))
  expect(toasts.at(-1)).toBe(`×${tNow('saves.error.unsafe', { reason: tNow('saves.wait.battle') })}`)
})

it('with quick save turned off, ignores hotkeys and refuses new quick saves but still loads existing ones', async () => {
  const { controller, okSnapshot, send, game } = setup()
  await okSnapshot({ op: 'save', target: 'quick', slot: 2 })
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), quickEnabled: false }, expectedRevision: 0 })
  expect(controller.quickHotkeysEnabled()).toBe(false)
  game.state = 'B'
  controller.hotkey('save', 5)
  await new Promise((r) => setTimeout(r, 0))
  expect(await send({ op: 'save', target: 'quick', slot: 5 })).toEqual(expect.objectContaining({ ok: false, error: tNow('saves.error.quickOff') }))
  const snapshot = await okSnapshot({ op: 'load', entryId: 'quick-2' })
  expect(game.state).toBe('A')
  expect(snapshot.index.entries.filter((e) => e.list === 'quick').map((e) => e.id)).toEqual(['quick-2'])
})

it('loads a save without writing a new one, and auto saves only after a full interval of play', async () => {
  const { controller, okSnapshot, game, calls, input } = setup()
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), enabled: true, intervalMin: 1 }, expectedRevision: 0 })
  const saved = await okSnapshot({ op: 'save', target: 'auto' })
  controller.start()
  controller.dispose()
  const advance = (frames: number) => {
    game.frames += frames
    controller.tick()
  }
  for (let i = 0; i < 100; i++) advance(30)
  game.state = 'B'
  game.fingerprint = 'm2'
  let snapshot = await okSnapshot({ op: 'load', entryId: saved.index.entries[0].id })
  expect(game.state).toBe('A')
  expect(calls).toEqual(['beforeLoad', 'afterLoad'])
  expect(snapshot.index.entries).toHaveLength(1)
  expect(controller.status().nextDueInMs).toBe(60_000)

  for (let i = 0; i < 125; i++) advance(30)
  expect(controller.status().waiting).toBe('idle')
  input()
  for (let i = 0; i < 3; i++) advance(30)
  await new Promise((r) => setTimeout(r, 0))
  snapshot = await okSnapshot({ op: 'snapshot' })
  expect(snapshot.index.entries).toHaveLength(2)
})

it('rolls back and leaves no backup when loading fails', async () => {
  const { okSnapshot, send, game } = setup()
  game.state = 'B'
  await okSnapshot({ op: 'save', target: 'quick', slot: 1 })
  game.state = 'A'
  game.failRestore = true
  const reply = await send({ op: 'load', entryId: 'quick-1' })
  expect(reply.ok).toBe(false)
  expect(game.state).toBe('A')
  const snapshot = await okSnapshot({ op: 'snapshot' })
  expect(snapshot.index.entries.map((e) => e.id)).toEqual(['quick-1'])
})

it('reports an empty quick slot and rejects stale settings', async () => {
  const { send } = setup()
  expect(await send({ op: 'load', entryId: 'quick-4' })).toEqual(expect.objectContaining({ ok: false, code: 'empty', error: tNow('saves.error.slotEmpty', { slot: 4 }) }))
  expect(await send({ op: 'configure', settings: parseGameSavesSettings(null), expectedRevision: 5 })).toEqual(expect.objectContaining({ ok: false, code: 'stale' }))
})

it('keeps the page revision when the shared settings are newer than the game copy', async () => {
  const { okSnapshot } = setup()
  const snapshot = await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), revision: 9, enabled: true }, expectedRevision: 0 })
  expect(snapshot.settings).toEqual(expect.objectContaining({ revision: 9, enabled: true }))
})

it('lowering the limit deletes the oldest auto saves right away', async () => {
  const { okSnapshot } = setup()
  for (let i = 0; i < 20; i++) await okSnapshot({ op: 'save', target: 'auto' })
  const snapshot = await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), maxCount: 15 }, expectedRevision: 0 })
  expect(snapshot.index.entries).toHaveLength(15)
})

it('auto saves after the interval of active play once it has been safe for a second, and skips idle play', async () => {
  const { controller, okSnapshot, game, input } = setup()
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), enabled: true, intervalMin: 1 }, expectedRevision: 0 })
  controller.start()
  controller.dispose()
  const advance = (frames: number) => {
    game.frames += frames
    controller.tick()
  }
  for (let i = 0; i < 120; i++) advance(30)
  expect(controller.status().nextDueInMs).toBe(0)
  game.unsafe = 'battle'
  advance(30)
  expect(controller.status().waiting).toBe('battle')
  game.unsafe = null
  advance(30)
  advance(30)
  expect((await okSnapshot({ op: 'snapshot' })).index.entries).toHaveLength(0)
  advance(30)
  await new Promise((r) => setTimeout(r, 0))
  let snapshot = await okSnapshot({ op: 'snapshot' })
  expect(snapshot.index.entries).toEqual([expect.objectContaining({ tag: 'auto' })])

  for (let i = 0; i < 125; i++) advance(30)
  expect(controller.status().waiting).toBe('idle')
  input()
  for (let i = 0; i < 3; i++) advance(30)
  await new Promise((r) => setTimeout(r, 0))
  snapshot = await okSnapshot({ op: 'snapshot' })
  expect(snapshot.index.entries).toHaveLength(2)
})

it('does not count time while inactive', async () => {
  const { controller, okSnapshot, game } = setup()
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), enabled: true, intervalMin: 1 }, expectedRevision: 0 })
  game.active = false
  for (let i = 0; i < 200; i++) {
    game.frames += 30
    controller.tick()
  }
  expect(controller.status().nextDueInMs).toBe(60_000)
  expect(controller.status().counting).toBe(false)
  game.active = true
  expect(controller.status().counting).toBe(true)
})

it('removes the content file of a new auto save whose index commit fails', async () => {
  const { send, backend } = setup()
  backend.writeIndex = async () => {
    throw new Error('disk full')
  }
  expect(await send({ op: 'save', target: 'auto' })).toEqual(expect.objectContaining({ ok: false }))
  expect([...backend.files.keys()].filter((k) => k.startsWith('auto/'))).toEqual([])
})

it('keeps the elapsed time when the game turns unsafe after the timer save was queued', async () => {
  const { controller, okSnapshot, game, input } = setup()
  controller.start()
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), enabled: true, intervalMin: 1 }, expectedRevision: 0 })
  input()
  for (let i = 0; i < 125; i++) {
    game.frames += 30
    controller.tick()
  }
  game.unsafe = 'battle'
  await new Promise((r) => setTimeout(r, 0))
  expect(controller.status().nextDueInMs).toBe(0)
  controller.dispose()
})

it('reconciles index entries whose files are gone and recovers files missing from the index', async () => {
  const first = setup()
  await first.okSnapshot({ op: 'save', target: 'quick', slot: 0 })
  await first.okSnapshot({ op: 'save', target: 'quick', slot: 1 })
  first.backend.files.delete('quick/quick-0')
  const orphanAt = Date.UTC(2026, 0, 2, 3, 4, 5)
  const orphanId = newAutoEntryId(orphanAt)
  await first.backend.writeEntry('auto', orphanId, new Uint8Array([1]), null)
  await first.backend.writeEntry('quick', 'quick-7', new Uint8Array([1]), null)
  const restarted = new GameSavesController({ ...(first.controller as unknown as { env: GameSavesEnv }).env })
  await restarted.whenReady()
  const entries = restarted.snapshot().index.entries
  expect(entries.map((e) => e.id).sort()).toEqual([orphanId, 'quick-1', 'quick-7'].sort())
  expect(entries.find((e) => e.id === orphanId)).toMatchObject({ list: 'auto', tag: 'auto', savedAt: orphanAt })
  expect(entries.find((e) => e.id === 'quick-7')).toMatchObject({ list: 'quick', slot: 7 })
})

it('keeps the old quick save when overwriting it fails to commit', async () => {
  const { okSnapshot, send, backend, game } = setup()
  await okSnapshot({ op: 'save', target: 'quick', slot: 0 })
  const writeIndex = backend.writeIndex
  backend.writeIndex = async () => {
    throw new Error('disk full')
  }
  game.state = 'B'
  expect(await send({ op: 'save', target: 'quick', slot: 0 })).toEqual(expect.objectContaining({ ok: false }))
  backend.writeIndex = writeIndex
  expect(JSON.parse(await gunzipText(await backend.readEntry('quick', 'quick-0')))).toEqual({ state: 'A' })
})

it('waits instead of retrying every second while the auto save location is offline', async () => {
  const appStore: GameSaveEntryStore = {
    ...createMemoryBackend(),
    readIndex: async () => {
      throw new Error('offline')
    },
  }
  const { controller, okSnapshot, game, toasts } = setup({ appStore })
  await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), enabled: true, intervalMin: 1, autoStorage: 'app' }, expectedRevision: 0 })
  for (let i = 0; i < 130; i++) {
    game.frames += 30
    controller.tick()
  }
  await new Promise((r) => setTimeout(r, 0))
  expect(controller.status().waiting).toBe('offline')
  expect(toasts).toEqual([])
})

it('applies a settings change queued behind a load', async () => {
  const { okSnapshot, send } = setup()
  await okSnapshot({ op: 'save', target: 'quick', slot: 0 })
  const load = send({ op: 'load', entryId: 'quick-0' })
  const configured = okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), quickEnabled: true, quickStorage: 'app' }, expectedRevision: 0 })
  expect((await load).ok).toBe(true)
  expect((await configured).settings.quickStorage).toBe('app')
})

it('stores each list where its setting points and keeps the other location untouched', async () => {
  const { okSnapshot, backend, appStore } = setup()
  const app = appStore as ReturnType<typeof createMemoryBackend>
  await okSnapshot({ op: 'save', target: 'quick', slot: 1 })
  let snapshot = await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), quickEnabled: true, quickStorage: 'app' }, expectedRevision: 0 })
  expect(snapshot.index.entries).toEqual([])
  snapshot = await okSnapshot({ op: 'save', target: 'quick', slot: 2 })
  await okSnapshot({ op: 'save', target: 'auto' })
  expect([...app.files.keys()]).toEqual(['quick/quick-2'])
  expect([...backend.files.keys()].sort()).toEqual([expect.stringMatching(/^auto\//), 'quick/quick-1'])
  snapshot = await okSnapshot({ op: 'configure', settings: { ...snapshot.settings, quickStorage: 'game' }, expectedRevision: snapshot.settings.revision })
  expect(snapshot.index.entries.filter((e) => e.list === 'quick').map((e) => e.id)).toEqual(['quick-1'])
})

it('reports an unreachable app store as offline and refuses to save there', async () => {
  const down = createMemoryBackend()
  let reachable = false
  const appStore: GameSaveEntryStore = {
    ...down,
    readIndex: async () => {
      if (!reachable) throw new Error('offline')
      return down.readIndex()
    },
  }
  const { okSnapshot, send } = setup({ appStore })
  const snapshot = await okSnapshot({ op: 'configure', settings: { ...parseGameSavesSettings(null), quickEnabled: true, autoStorage: 'app' }, expectedRevision: 0 })
  expect(snapshot.status.offline).toEqual(['auto'])
  expect(await send({ op: 'save', target: 'auto' })).toEqual(expect.objectContaining({ ok: false, error: tNow('saves.error.appOffline') }))
  expect((await okSnapshot({ op: 'save', target: 'quick', slot: 0 })).index.entries).toHaveLength(1)
  reachable = true
  expect((await okSnapshot({ op: 'snapshot' })).status.offline).toEqual([])
})

it('refuses saves while a load is waiting in the queue', async () => {
  const { okSnapshot, send } = setup()
  await okSnapshot({ op: 'save', target: 'quick', slot: 0 })
  const first = send({ op: 'save', target: 'quick', slot: 1 })
  const load = send({ op: 'load', entryId: 'quick-0' })
  const after = send({ op: 'save', target: 'auto' })
  expect(await after).toEqual(expect.objectContaining({ ok: false, error: tNow('saves.error.loading') }))
  expect((await first).ok).toBe(true)
  expect((await load).ok).toBe(true)
  expect((await okSnapshot({ op: 'save', target: 'auto' })).index.entries).toHaveLength(3)
})

it('refreshes instead of overwriting when another window changed the index first', async () => {
  const first = setup()
  const env = (first.controller as unknown as { env: GameSavesEnv }).env
  const second = new GameSavesController({ ...env })
  await first.controller.whenReady()
  await second.whenReady()
  await first.okSnapshot({ op: 'save', target: 'quick', slot: 1 })
  const changed = jest.fn()
  window.addEventListener(GAME_SAVES_CHANGED_EVENT, changed)
  const reply = await new Promise<Reply>((resolve) =>
    second.request({ type: 'saves.cmd', reqId: 'w2', gameId: 'g1', op: 'save', target: 'quick', slot: 2 } as GameLinkMessage, (message) => {
      if (message.type === 'saves.reply') resolve(message)
    })
  )
  expect(reply).toEqual(expect.objectContaining({ ok: false, error: tNow('saves.error.indexConflict') }))
  expect(second.snapshot().index.entries.map((e) => e.id)).toEqual(['quick-1'])
  expect(changed).toHaveBeenCalled()
  window.removeEventListener(GAME_SAVES_CHANGED_EVENT, changed)
  expect([...first.backend.files.keys()]).toEqual(['quick/quick-1'])
  expect((await first.okSnapshot({ op: 'save', target: 'quick', slot: 3 })).index.entries).toHaveLength(2)
})
