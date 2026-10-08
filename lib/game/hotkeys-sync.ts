export type HotkeyBindings = Record<string, string>

export type HotkeySyncSnapshot = {
  version: 1
  global: { revision: number; bindings: HotkeyBindings; disabled: string[] }
  game: { gameId: string; revision: number; bindings: HotkeyBindings | null }
}

export type HotkeyDomain = 'global' | 'game'

export const HOTKEY_GLOBAL_STORAGE_KEY = 'chaya.hotkeys.v1.global'
export const hotkeyGameStorageKey = (gameId: string) => `chaya.hotkeys.v1.game:${gameId}`

const MAX_BINDINGS = 500
const MAX_CHORD_LENGTH = 80

function revision(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

export function normalizeHotkeyBindings(value: unknown, validTarget: (id: string) => boolean): HotkeyBindings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_BINDINGS) return null
  const bindings: HotkeyBindings = {}
  for (const [id, raw] of entries) {
    if (!validTarget(id) || typeof raw !== 'string') return null
    const chord = raw.trim()
    if (!chord || chord.length > MAX_CHORD_LENGTH) return null
    bindings[id] = chord
  }
  return bindings
}

export function normalizeHotkeySnapshot(value: unknown, gameId: string, validTarget: (id: string) => boolean, canDisable: (id: string) => boolean): HotkeySyncSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  if (root.version !== 1 || !root.global || typeof root.global !== 'object' || !root.game || typeof root.game !== 'object') return null
  const global = root.global as Record<string, unknown>
  const game = root.game as Record<string, unknown>
  if (game.gameId !== gameId) return null
  const globalBindings = normalizeHotkeyBindings(global.bindings, validTarget)
  const gameBindings = game.bindings === null ? null : normalizeHotkeyBindings(game.bindings, validTarget)
  if (!globalBindings || (game.bindings !== null && !gameBindings)) return null
  if (!Array.isArray(global.disabled) || global.disabled.some((id) => typeof id !== 'string' || !validTarget(id) || !canDisable(id))) return null
  return {
    version: 1,
    global: { revision: revision(global.revision), bindings: globalBindings, disabled: [...new Set(global.disabled as string[])] },
    game: { gameId, revision: revision(game.revision), bindings: gameBindings },
  }
}

export function emptyHotkeySnapshot(gameId: string): HotkeySyncSnapshot {
  return { version: 1, global: { revision: 0, bindings: {}, disabled: [] }, game: { gameId, revision: 0, bindings: null } }
}

export function sameHotkeyDomain(a: HotkeySyncSnapshot, b: HotkeySyncSnapshot, domain: HotkeyDomain): boolean {
  return JSON.stringify(a[domain]) === JSON.stringify(b[domain])
}

/** Higher revision wins independently. Equal-revision conflicts are resolved by the authoritative game snapshot. */
export function reconcileHotkeySnapshots(web: HotkeySyncSnapshot, game: HotkeySyncSnapshot): HotkeySyncSnapshot {
  return {
    version: 1,
    global: web.global.revision > game.global.revision ? web.global : game.global,
    game: web.game.revision > game.game.revision ? web.game : game.game,
  }
}

export function editHotkeySnapshot(
  snapshot: HotkeySyncSnapshot,
  domain: HotkeyDomain,
  patch: Partial<HotkeySyncSnapshot['global']> | Partial<HotkeySyncSnapshot['game']>
): HotkeySyncSnapshot {
  if (domain === 'global') return { ...snapshot, global: { ...snapshot.global, ...(patch as Partial<HotkeySyncSnapshot['global']>), revision: snapshot.global.revision + 1 } }
  return { ...snapshot, game: { ...snapshot.game, ...(patch as Partial<HotkeySyncSnapshot['game']>), revision: snapshot.game.revision + 1 } }
}

export function loadStoredHotkeySnapshot(
  storage: Pick<Storage, 'getItem'>,
  gameId: string,
  validTarget: (id: string) => boolean,
  canDisable: (id: string) => boolean
): HotkeySyncSnapshot {
  try {
    const global = JSON.parse(storage.getItem(HOTKEY_GLOBAL_STORAGE_KEY) || 'null') as unknown
    const game = JSON.parse(storage.getItem(hotkeyGameStorageKey(gameId)) || 'null') as unknown
    return (
      normalizeHotkeySnapshot({ version: 1, global, game: game && typeof game === 'object' ? { ...(game as object), gameId } : game }, gameId, validTarget, canDisable) ??
      emptyHotkeySnapshot(gameId)
    )
  } catch {
    return emptyHotkeySnapshot(gameId)
  }
}

export function saveStoredHotkeySnapshot(storage: Pick<Storage, 'setItem'>, snapshot: HotkeySyncSnapshot): void {
  storage.setItem(HOTKEY_GLOBAL_STORAGE_KEY, JSON.stringify(snapshot.global))
  storage.setItem(hotkeyGameStorageKey(snapshot.game.gameId), JSON.stringify({ revision: snapshot.game.revision, bindings: snapshot.game.bindings }))
}

export type HotkeyCasResult = { ok: true; snapshot: HotkeySyncSnapshot } | { ok: false; reason: 'stale' | 'invalid'; snapshot: HotkeySyncSnapshot }

export function applyHotkeyCas(current: HotkeySyncSnapshot, incoming: HotkeySyncSnapshot, expectedGlobalRevision: number, expectedGameRevision: number): HotkeyCasResult {
  if (incoming.game.gameId !== current.game.gameId) return { ok: false, reason: 'invalid', snapshot: current }
  if (expectedGlobalRevision !== current.global.revision || expectedGameRevision !== current.game.revision) return { ok: false, reason: 'stale', snapshot: current }
  if (incoming.global.revision < current.global.revision || incoming.game.revision < current.game.revision) return { ok: false, reason: 'stale', snapshot: current }
  if (incoming.global.revision === current.global.revision && JSON.stringify(incoming.global) !== JSON.stringify(current.global)) {
    return { ok: false, reason: 'stale', snapshot: current }
  }
  if (incoming.game.revision === current.game.revision && JSON.stringify(incoming.game) !== JSON.stringify(current.game)) {
    return { ok: false, reason: 'stale', snapshot: current }
  }
  return { ok: true, snapshot: incoming }
}
