import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { assertIndexRevision, type GameSaveList, type GameSavesIndex, isGameSaveEntryId, parseGameSavesIndex } from '@/lib/game/game-saves'
import { toolkitDataDir } from '@/lib/game/toolkit-data'

const CONTENT_EXT = '.rpgsave.gz'
const THUMB_EXT = '.jpg'
const SAFE_GAME_ID = /^[A-Za-z0-9_-]{1,96}$/

/** 存到 Chaya 本机的存档：`data/game-saves/games/<游戏>/`，结构与游戏目录里的一致 */
export class GameSavesAppStore {
  readonly root: string

  constructor(gameId: string, dataDir = toolkitDataDir()) {
    const dir = SAFE_GAME_ID.test(gameId) ? gameId : `id-${createHash('sha256').update(gameId).digest('hex').slice(0, 32)}`
    this.root = path.join(dataDir, 'game-saves', 'games', dir)
  }

  private file(list: GameSaveList, id: string, ext: string): string {
    if (!isGameSaveEntryId(id) || id.startsWith('quick-') !== (list === 'quick')) throw new Error(`invalid entry id: ${id}`)
    return path.join(this.root, list, id + ext)
  }

  private writeAtomic(file: string, data: string | Uint8Array): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, data)
    fs.renameSync(temporary, file)
  }

  private removeQuiet(file: string): void {
    fs.rmSync(file, { force: true })
  }

  /** 只有文件不存在算空；内容损坏时留一份副本再按空处理，由插件对账把内容文件补回索引 */
  readIndex(): GameSavesIndex | null {
    const file = path.join(this.root, 'index.json')
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      return parseGameSavesIndex(JSON.parse(text))
    } catch {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
      return null
    }
  }

  /** 同步读-比-写：Node 单线程内不会与另一次请求交错 */
  writeIndex(index: GameSavesIndex, expectedRevision?: number): void {
    assertIndexRevision(this.readIndex(), expectedRevision)
    this.writeAtomic(path.join(this.root, 'index.json'), JSON.stringify(parseGameSavesIndex(index)))
  }

  writeEntry(list: GameSaveList, id: string, data: Buffer, thumb: string | null): void {
    this.writeAtomic(this.file(list, id, CONTENT_EXT), data)
    const base64 = thumb?.startsWith('data:image/jpeg;base64,') ? thumb.slice(23) : null
    if (base64) this.writeAtomic(this.file(list, id, THUMB_EXT), Buffer.from(base64, 'base64'))
    else this.removeQuiet(this.file(list, id, THUMB_EXT))
  }

  readEntry(list: GameSaveList, id: string): Buffer {
    return fs.readFileSync(this.file(list, id, CONTENT_EXT))
  }

  readThumb(list: GameSaveList, id: string): string | null {
    try {
      return `data:image/jpeg;base64,${fs.readFileSync(this.file(list, id, THUMB_EXT)).toString('base64')}`
    } catch {
      return null
    }
  }

  removeEntry(list: GameSaveList, id: string): void {
    this.removeQuiet(this.file(list, id, CONTENT_EXT))
    this.removeQuiet(this.file(list, id, THUMB_EXT))
  }

  listEntries(list: GameSaveList): string[] {
    const dir = path.join(this.root, list)
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    for (const name of names) if (name.endsWith('.tmp')) this.removeQuiet(path.join(dir, name))
    return names.filter((name) => name.endsWith(CONTENT_EXT)).map((name) => name.slice(0, -CONTENT_EXT.length))
  }
}
