import {
  entryListOf,
  type GameSaveEntry,
  type GameSaveList,
  type GameSavesIndex,
  type GameSavesSettings,
  type GameSaveStorage,
  parseGameSavesIndex,
  recoverOrphanEntry,
  SaveIndexConflictError,
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

  /**
   * 写入合并后的条目：每处只替换放在该处的列表，未变化的位置不写。
   * `removed` 与索引同一次写入记为待清理；内容文件删掉后由 `purge` 去掉记录，删不掉的由对账重试
   */
  async commit(entries: GameSaveEntry[], removed: readonly string[] = []): Promise<void> {
    const writes: [GameSaveStorage, GameSavesIndex][] = []
    for (const place of new Set(Object.values(this.route))) {
      const lists = LISTS.filter((list) => this.route[list] === place)
      const current = this.indices[place]
      const mine = entries.filter((e) => lists.includes(e.list))
      const mineRemoved = removed.filter((id) => lists.includes(entryListOf(id)))
      if (!current) {
        if (mine.length || mineRemoved.length) this.store(lists[0])
        continue
      }
      const kept = current.entries.filter((e) => !lists.includes(e.list))
      const before = current.entries.filter((e) => lists.includes(e.list))
      const next = [...kept, ...mine]
      const live = new Set(next.map((e) => e.id))
      const removing = [...new Set([...(current.removing ?? []), ...mineRemoved])].filter((id) => !live.has(id))
      if (JSON.stringify(before) === JSON.stringify(mine) && JSON.stringify(removing) === JSON.stringify(current.removing ?? [])) continue
      writes.push([place, { version: 1, revision: current.revision + 1, entries: next, ...(removing.length ? { removing } : {}) }])
    }
    for (const [place, index] of writes) {
      try {
        await this.stores[place].writeIndex(index, index.revision - 1)
      } catch (error) {
        if (!(error instanceof SaveIndexConflictError)) throw error
        await this.reload(place)
        throw new SaveIndexConflictError(tNow('saves.error.indexConflict'))
      }
      this.indices[place] = index
    }
  }

  /** 删除已在索引中记为待清理的内容文件，删掉的再从记录中去掉；失败的留给下次对账 */
  async purge(list: GameSaveList, ids: readonly string[]): Promise<void> {
    const place = this.route[list]
    const store = this.stores[place]
    const done = new Set<string>()
    for (const id of ids) {
      try {
        await store.removeEntry(list, id)
        done.add(id)
      } catch (error) {
        this.log.warn(`删除存档文件失败，下次启动时重试（${PLACE_LABEL[place]}）`, error)
      }
    }
    const current = this.indices[place]
    const removing = current?.removing?.filter((id) => !done.has(id))
    if (!current || !removing || removing.length === current.removing!.length) return
    const next: GameSavesIndex = { version: 1, revision: current.revision + 1, entries: current.entries, ...(removing.length ? { removing } : {}) }
    try {
      await store.writeIndex(next, current.revision)
      this.indices[place] = next
    } catch (error) {
      this.log.warn(`清除待删除记录失败（${PLACE_LABEL[place]}）`, error)
    }
  }

  /** 重读该列表所在位置的索引，确认磁盘上的现状 */
  async reread(list: GameSaveList): Promise<void> {
    await this.reload(this.route[list])
  }

  /** 另一个窗口改过该处索引：换成磁盘上的版本；读失败则标为离线，下次 retry 再读 */
  private async reload(place: GameSaveStorage): Promise<void> {
    try {
      const previous = this.indices[place]
      const next = parseGameSavesIndex(await this.stores[place].readIndex())
      this.indices[place] = next
      if (previous?.revision !== next.revision) this.log.warn(`存档索引已被其他窗口更新，已重新读取（${PLACE_LABEL[place]}）`)
    } catch (error) {
      delete this.indices[place]
      this.log.fail(`重新读取存档索引失败（${PLACE_LABEL[place]}）`, error)
    }
  }

  /**
   * 索引与内容文件对账：缺文件的条目移除；待清理的文件删掉；其余索引外的文件补成最小条目
   * （索引损坏时那就是全部存档，不补回则不会出现在列表里，快速槽覆盖前也找不到旧条目来备份）
   */
  private async reconcile(place: GameSaveStorage): Promise<void> {
    const store = this.stores[place]
    const index = this.indices[place]!
    const removing = new Set(index.removing ?? [])
    const missing = new Set<string>()
    const recovered: GameSaveEntry[] = []
    const present = new Set<string>()
    for (const list of LISTS) {
      const files = new Set(await store.listEntries(list))
      const known = new Set<string>()
      for (const entry of index.entries) {
        if (entry.list !== list) continue
        known.add(entry.id)
        if (!files.has(entry.id)) missing.add(entry.id)
      }
      for (const id of files) {
        if (known.has(id)) continue
        if (removing.has(id)) {
          await store.removeEntry(list, id).then(
            () => {},
            (error) => {
              present.add(id)
              this.log.warn(`对账删除待清理的存档文件失败（${PLACE_LABEL[place]}）`, error)
            }
          )
          continue
        }
        const entry = recoverOrphanEntry(list, id)
        if (entry) recovered.push(entry)
      }
    }
    const stillRemoving = [...removing].filter((id) => present.has(id))
    if (!missing.size && !recovered.length && stillRemoving.length === removing.size) return
    const entries = [...index.entries.filter((e) => !missing.has(e.id)), ...recovered]
    const next: GameSavesIndex = { version: 1, revision: index.revision + 1, entries, ...(stillRemoving.length ? { removing: stillRemoving } : {}) }
    await store.writeIndex(next, index.revision)
    this.indices[place] = next
    if (missing.size) this.log.warn(`对账移除 ${missing.size} 个缺少内容文件的存档条目（${PLACE_LABEL[place]}）`)
    if (recovered.length) this.log.warn(`对账找回 ${recovered.length} 个不在索引中的存档文件（${PLACE_LABEL[place]}）`)
  }
}
