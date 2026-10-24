import { gameContentRelPath, gameSavesRelDir } from '@/lib/game/content-paths'
import { assertIndexRevision, type GameSaveList, type GameSavesIndex } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'

import { detectGameIdentity } from '../../helpers/game/game-identity'
import { tryNodeFsPath, tryNodeRequire } from '../../helpers/node/node-require'
import { pluginStorageCall } from '../../helpers/storage/client'

/** 一处存放位置：索引、内容（gzip 后的字节）与缩略图（JPEG data URL） */
export type GameSaveEntryStore = {
  readIndex(): Promise<unknown>
  /** 给了 `expectedRevision` 时，已存的索引版本不同就抛 `SaveIndexConflictError`，不写入 */
  writeIndex(index: GameSavesIndex, expectedRevision?: number): Promise<void>
  writeEntry(list: GameSaveList, id: string, data: Uint8Array, thumb: string | null): Promise<void>
  readEntry(list: GameSaveList, id: string): Promise<Uint8Array>
  readThumb(list: GameSaveList, id: string): Promise<string | null>
  removeEntry(list: GameSaveList, id: string): Promise<void>
  /** 列出已有内容文件的条目 id，用于启动对账 */
  listEntries(list: GameSaveList): Promise<string[]>
}

/** 游戏侧持久化：设置副本与「存到游戏中」的存档 */
export type GameSavesBackend = GameSaveEntryStore & {
  kind: 'fs' | 'idb' | 'memory'
  readSettings(): Promise<unknown>
  writeSettings(value: unknown): Promise<void>
}

type NodeZlib = typeof import('zlib')

function nodeZlib(): NodeZlib | null {
  try {
    return (tryNodeRequire()?.('zlib') as NodeZlib | undefined) ?? null
  } catch {
    return null
  }
}

async function streamBytes(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function gzipText(text: string): Promise<Uint8Array> {
  const zlib = nodeZlib()
  if (zlib) return new Uint8Array(zlib.gzipSync(text))
  if (typeof CompressionStream === 'undefined') throw new Error(tNow('saves.error.noCompression'))
  return streamBytes(new TextEncoder().encode(text), new CompressionStream('gzip'))
}

export async function gunzipText(data: Uint8Array): Promise<string> {
  const zlib = nodeZlib()
  if (zlib) return zlib.gunzipSync(data).toString('utf8')
  if (typeof DecompressionStream === 'undefined') throw new Error(tNow('saves.error.noDecompression'))
  return new TextDecoder().decode(await streamBytes(data, new DecompressionStream('gzip')))
}

const CONTENT_EXT = '.rpgsave.gz'
const THUMB_EXT = '.jpg'

function createFsBackend(): GameSavesBackend | null {
  const modules = tryNodeFsPath()
  const identity = detectGameIdentity()
  if (!modules || !identity) return null
  const { fs, path } = modules
  const root = identity.contentRoot
  const indexFile = path.join(root, gameContentRelPath('gameSavesIndex'))
  const dir = (list: GameSaveList) => path.join(root, gameSavesRelDir(list))

  /** 只有文件不存在算空；读不了要报错，以免把已有存档当成没有。内容损坏时留一份副本再按空处理 */
  const readJson = (file: string): unknown => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      return JSON.parse(text)
    } catch {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
      return null
    }
  }
  const writeAtomic = (file: string, data: string | Uint8Array) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  }
  const removeQuiet = (file: string) => {
    try {
      fs.unlinkSync(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  return {
    kind: 'fs',
    readSettings: async () => pluginStorageCall('game.read', [root, 'gameSaves']),
    writeSettings: async (value) => {
      await pluginStorageCall('game.write', [root, 'gameSaves', value])
    },
    readIndex: async () => readJson(indexFile),
    async writeIndex(index, expectedRevision) {
      assertIndexRevision(readJson(indexFile), expectedRevision)
      writeAtomic(indexFile, JSON.stringify(index))
    },
    async writeEntry(list, id, data, thumb) {
      writeAtomic(path.join(dir(list), id + CONTENT_EXT), data)
      const thumbFile = path.join(dir(list), id + THUMB_EXT)
      const base64 = thumb?.startsWith('data:image/jpeg;base64,') ? thumb.slice(23) : null
      if (base64) writeAtomic(thumbFile, Buffer.from(base64, 'base64'))
      else removeQuiet(thumbFile)
    },
    readEntry: async (list, id) => new Uint8Array(fs.readFileSync(path.join(dir(list), id + CONTENT_EXT))),
    async readThumb(list, id) {
      try {
        return `data:image/jpeg;base64,${fs.readFileSync(path.join(dir(list), id + THUMB_EXT)).toString('base64')}`
      } catch {
        return null
      }
    },
    async removeEntry(list, id) {
      removeQuiet(path.join(dir(list), id + CONTENT_EXT))
      removeQuiet(path.join(dir(list), id + THUMB_EXT))
    },
    async listEntries(list) {
      let names: string[] = []
      try {
        names = fs.readdirSync(dir(list))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      for (const name of names) {
        if (!name.endsWith('.tmp')) continue
        try {
          removeQuiet(path.join(dir(list), name))
        } catch {
          /* 残留的临时文件不影响列出 */
        }
      }
      return names.filter((n) => n.endsWith(CONTENT_EXT)).map((n) => n.slice(0, -CONTENT_EXT.length))
    },
  }
}

export function createMemoryBackend(): GameSavesBackend & { files: Map<string, Uint8Array> } {
  const meta = new Map<string, unknown>()
  const files = new Map<string, Uint8Array>()
  const thumbs = new Map<string, string>()
  const key = (list: GameSaveList, id: string) => `${list}/${id}`
  return {
    kind: 'memory',
    files,
    readSettings: async () => structuredCloneSafe(meta.get('settings')),
    writeSettings: async (value) => void meta.set('settings', structuredCloneSafe(value)),
    readIndex: async () => structuredCloneSafe(meta.get('index')),
    async writeIndex(index, expectedRevision) {
      assertIndexRevision(meta.get('index'), expectedRevision)
      meta.set('index', structuredCloneSafe(index))
    },
    async writeEntry(list, id, data, thumb) {
      files.set(key(list, id), data)
      if (thumb) thumbs.set(key(list, id), thumb)
      else thumbs.delete(key(list, id))
    },
    async readEntry(list, id) {
      const data = files.get(key(list, id))
      if (!data) throw new Error(tNow('saves.error.contentMissing'))
      return data
    },
    readThumb: async (list, id) => thumbs.get(key(list, id)) ?? null,
    async removeEntry(list, id) {
      files.delete(key(list, id))
      thumbs.delete(key(list, id))
    },
    listEntries: async (list) => [...files.keys()].filter((k) => k.startsWith(`${list}/`)).map((k) => k.slice(list.length + 1)),
  }
}

function structuredCloneSafe<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

export function createGameSavesBackend(_roomId: string): GameSavesBackend {
  const backend = createFsBackend()
  if (!backend) throw new Error('游戏存档需要本机文件宿主；浏览器不能作为存档真源')
  return backend
}
