import {
  type GameSaveEntry,
  type GameSaveList,
  type GameSavesIndex,
  type GameSavesSettings,
  type GameSaveStorage,
  parseGameSavesIndex,
  recoverOrphanEntry,
  saveStorageOf,
} from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'

import type { GameSaveEntryStore } from './store'

const LISTS = ['auto', 'quick'] as const satisfies readonly GameSaveList[]
const PLACE_LABEL: Record<GameSaveStorage, string> = { game: '游戏中', app: 'Chaya 本机' }

type Log = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; fail: (...args: unknown[]) => void }

/**
 * 按设置把自动 / 快速存档分别放在游戏中或 Chaya 本机。
 * 每处各有一份索引，只改当前放在该处的列表；切换位置后原处的存档保留，切回即可看到。
 */
export class RoutedSaveStore {
  private readonly indices: Partial<Record<GameSaveStorage, GameSavesIndex>> = {}
  private route: Record<GameSaveList, GameSaveStorage> = { auto: 'game', quick: 'game' }

  constructor(
    private readonly stores: Record<GameSaveStorage, GameSaveEntryStore>,
    private readonly log: Log
  ) {}

  /** 按设置切换位置并读取尚未读过的索引；返回位置是否变化 */
  async apply(settings: GameSavesSettings): Promise<boolean> {
    const next = { auto: saveStorageOf(settings, 'auto'), quick: saveStorageOf(settings, 'quick') }
    const changed = next.auto !== this.route.auto || next.quick !== this.route.quick
    this.route = next
    await this.retry()
    return changed
  }

  /** 重读读取失败的位置；返回是否有位置恢复 */
  async retry(): Promise<boolean> {
    let recovered = false
    for (const place of new Set(Object.values(this.route))) {
      if (this.indices[place]) continue
      try {
        this.indices[place] = parseGameSavesIndex(await this.stores[place].readIndex())
        recovered = true
      } catch (error) {
        this.log.fail(`读取存档索引失败（${PLACE_LABEL[place]}）`, error)
        continue
      }
      await this.reconcile(place).catch((error) => this.log.warn(`存档对账失败（${PLACE_LABEL[place]}）`, error))
    }
    return recovered
  }

  offline(): GameSaveList[] {
    return LISTS.filter((list) => !this.indices[this.route[list]])
  }

  entries(): GameSaveEntry[] {
    return LISTS.flatMap((list) => this.indices[this.route[list]]?.entries.filter((e) => e.list === list) ?? [])
  }

  /** 当前列表所在位置；读取失败时报错，不写入 */
  store(list: GameSaveList): GameSaveEntryStore {
    if (!this.indices[this.route[list]]) throw new Error(tNow(this.route[list] === 'app' ? 'saves.error.appOffline' : 'saves.error.storageOpen'))
    return this.stores[this.route[list]]
  }

  /** 写入合并后的条目：每处只替换放在该处的列表，未变化的位置不写 */
  async commit(entries: GameSaveEntry[]): Promise<void> {
    const writes: [GameSaveStorage, GameSavesIndex][] = []
    for (const place of new Set(Object.values(this.route))) {
      const lists = LISTS.filter((list) => this.route[list] === place)
      const current = this.indices[place]
      const mine = entries.filter((e) => lists.includes(e.list))
      if (!current) {
        if (mine.length) this.store(mine[0].list)
        continue
      }
      const kept = current.entries.filter((e) => !lists.includes(e.list))
      const before = current.entries.filter((e) => lists.includes(e.list))
      if (JSON.stringify(before) === JSON.stringify(mine)) continue
      writes.push([place, { version: 1, revision: current.revision + 1, entries: [...kept, ...mine] }])
    }
    for (const [place, index] of writes) {
      await this.stores[place].writeIndex(index)
      this.indices[place] = index
    }
  }

  /**
   * 索引与内容文件对账：缺文件的条目移除；索引外的文件补成最小条目（索引损坏时那就是全部存档，
   * 不补回则不会出现在列表里，快速槽覆盖前也找不到旧条目来备份）
   */
  private async reconcile(place: GameSaveStorage): Promise<void> {
    const store = this.stores[place]
    const index = this.indices[place]!
    const missing = new Set<string>()
    const recovered: GameSaveEntry[] = []
    for (const list of LISTS) {
      const files = new Set(await store.listEntries(list))
      const known = new Set<string>()
      for (const entry of index.entries) {
        if (entry.list !== list) continue
        known.add(entry.id)
        if (!files.has(entry.id)) missing.add(entry.id)
      }
      for (const id of files) {
        const entry = known.has(id) ? null : recoverOrphanEntry(list, id)
        if (entry) recovered.push(entry)
      }
    }
    if (!missing.size && !recovered.length) return
    const entries = [...index.entries.filter((e) => !missing.has(e.id)), ...recovered]
    const next = { ...index, revision: index.revision + 1, entries }
    await store.writeIndex(next)
    this.indices[place] = next
    if (missing.size) this.log.warn(`对账移除 ${missing.size} 个缺少内容文件的存档条目（${PLACE_LABEL[place]}）`)
    if (recovered.length) this.log.warn(`对账找回 ${recovered.length} 个不在索引中的存档文件（${PLACE_LABEL[place]}）`)
  }
}
