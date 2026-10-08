import { applyHotkeyCas, editHotkeySnapshot, emptyHotkeySnapshot, loadStoredHotkeySnapshot, reconcileHotkeySnapshots, saveStoredHotkeySnapshot } from '@/lib/game/hotkeys-sync'

describe('hotkey sync', () => {
  it('versions global and game independently', () => {
    const base = emptyHotkeySnapshot('g1')
    const global = editHotkeySnapshot(base, 'global', { bindings: { a: 'A' } })
    const game = editHotkeySnapshot(global, 'game', { bindings: { b: 'B' } })
    expect(game).toMatchObject({ global: { revision: 1 }, game: { revision: 1 } })
  })

  it('takes newer domains independently and lets game win ties', () => {
    const base = emptyHotkeySnapshot('g1')
    const web = { ...base, global: { revision: 2, bindings: { a: 'A' }, disabled: [] }, game: { gameId: 'g1', revision: 1, bindings: { w: 'W' } } }
    const game = { ...base, global: { revision: 1, bindings: { b: 'B' }, disabled: [] }, game: { gameId: 'g1', revision: 1, bindings: { g: 'G' } } }
    expect(reconcileHotkeySnapshots(web, game)).toMatchObject({ global: web.global, game: game.game })
  })

  it('rejects stale CAS without mutating authority', () => {
    const current = editHotkeySnapshot(emptyHotkeySnapshot('g1'), 'global', { bindings: { a: 'A' } })
    const incoming = editHotkeySnapshot(current, 'game', { bindings: { b: 'B' } })
    expect(applyHotkeyCas(current, incoming, 0, 0)).toEqual({ ok: false, reason: 'stale', snapshot: current })
    expect(applyHotkeyCas(current, incoming, 1, 0)).toEqual({ ok: true, snapshot: incoming })
  })

  it('stores game overrides by game id and ignores non-v1 data', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    const first = editHotkeySnapshot(emptyHotkeySnapshot('g1'), 'game', { bindings: { a: 'A' } })
    const second = editHotkeySnapshot(emptyHotkeySnapshot('g2'), 'game', { bindings: { b: 'B' } })
    saveStoredHotkeySnapshot(storage, first)
    saveStoredHotkeySnapshot(storage, second)
    expect(
      loadStoredHotkeySnapshot(
        storage,
        'g1',
        () => true,
        () => true
      ).game.bindings
    ).toEqual({ a: 'A' })
    expect(
      loadStoredHotkeySnapshot(
        storage,
        'g2',
        () => true,
        () => true
      ).game.bindings
    ).toEqual({ b: 'B' })
    values.set('chaya.hotkeys.v1.global', JSON.stringify({ bindings: { legacy: 'L' } }))
    expect(
      loadStoredHotkeySnapshot(
        storage,
        'g1',
        () => true,
        () => true
      )
    ).toEqual(emptyHotkeySnapshot('g1'))
  })
})
