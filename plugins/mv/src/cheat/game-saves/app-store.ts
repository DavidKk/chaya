import { type GameSavesAppStoreOp, SAVE_INDEX_CONFLICT, SaveIndexConflictError } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'

import { chayaPostJson } from '../../helpers/net/http'
import type { GameSaveEntryStore } from './store'

type Post = (body: GameSavesAppStoreOp) => Promise<Record<string, unknown>>
type OpBody = GameSavesAppStoreOp extends infer T ? (T extends unknown ? Omit<T, 'gameId'> : never) : never

function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function postStore(body: GameSavesAppStoreOp): Promise<Record<string, unknown>> {
  let json: { ok?: boolean; error?: { code?: string; message?: string } } & Record<string, unknown>
  try {
    const response = await chayaPostJson('/api/game-saves/store', body)
    json = await response.json()
  } catch {
    throw new Error(tNow('saves.error.appOffline'))
  }
  if (json?.error?.code === SAVE_INDEX_CONFLICT) throw new SaveIndexConflictError(json.error.message)
  if (!json?.ok) throw new Error(json?.error?.message ? tNow('saves.error.appRejected', { reason: json.error.message }) : tNow('saves.error.appOffline'))
  return json
}

/** 存到 Chaya 本机：经本机服务读写 `data/game-saves/games/<游戏>/` */
export function createAppEntryStore(gameId: () => string, post: Post = postStore): GameSaveEntryStore {
  const call = (body: OpBody) => post({ ...body, gameId: gameId() } as GameSavesAppStoreOp)
  return {
    readIndex: async () => (await call({ op: 'readIndex' })).index ?? null,
    writeIndex: async (index, expectedRevision) => void (await call({ op: 'writeIndex', index, expectedRevision })),
    writeEntry: async (list, id, data, thumb) => void (await call({ op: 'writeEntry', list, id, data: toBase64(data), thumb })),
    readEntry: async (list, id) => fromBase64(String((await call({ op: 'readEntry', list, id })).data ?? '')),
    readThumb: async (list, id) => ((await call({ op: 'readThumb', list, id })).thumb as string | null) ?? null,
    removeEntry: async (list, id) => void (await call({ op: 'removeEntry', list, id })),
    listEntries: async (list) => ((await call({ op: 'listEntries', list })).ids as string[]) ?? [],
  }
}
