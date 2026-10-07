import {
  type GameSaveEntry,
  type GameSaveList,
  type GameSavesErrorCode,
  type GameSavesIndex,
  type GameSaveSource,
  type GameSavesSettings,
  type GameSavesSnapshot,
  type GameSavesStatus,
  type GameSaveStorage,
  type GameSaveTag,
  isGameSaveEntryId,
  isQuickSlot,
  newAutoEntryId,
  parseGameSavesIndex,
  parseGameSavesSettings,
  planRotation,
  quickEntryId,
  type SaveWaitReason,
  saveWaitReasonKey,
  validateGameSavesSettings,
} from '@/lib/game/game-saves'
import { MESSAGES, tNow, translate } from '@/lib/i18n'
import type { GameLinkMessage, GameSavesMessage } from '@/lib/runtime/game-link-protocol'

import type { GameSavesEnv } from './env'
import { GAME_SAVES_CHANGED_EVENT, GAME_SAVES_STATUS_EVENT } from './events'
import { RoutedSaveStore } from './routed-store'
import type { SaveMeta } from './serialize'
import { gunzipText, gzipText } from './store'

type Send = (message: GameLinkMessage) => void
type Cmd = Extract<GameSavesMessage, { type: 'saves.cmd' }>
type Reply = Extract<GameSavesMessage, { type: 'saves.reply' }>

const FPS = 60
const TICK_MS = 500
const STABLE_TICKS = 3
const STATUS_EVERY_TICKS = 10
/** 单次轮询帧增量的上限；读档会把帧计数改回存档时的值，跳变不计入 */
const MAX_TICK_FRAMES = 600

export class GameSavesError extends Error {
  constructor(
    message: string,
    readonly code: GameSavesErrorCode,
    readonly reason?: SaveWaitReason
  ) {
    super(message)
  }
}

const listLabel = (entry: Pick<GameSaveEntry, 'list' | 'slot'>) => (entry.list === 'quick' ? `槽 ${entry.slot}` : '自动存档')
const sourceLabel: Record<GameSaveSource, string> = { timer: '定时', page: '页面', hotkey: '快捷键' }
const placeLabel: Record<GameSaveStorage, string> = { game: '存到游戏中', app: '存到 Chaya 本机' }

export class GameSavesController {
  private settings: GameSavesSettings = parseGameSavesSettings(null)
  private index: GameSavesIndex = parseGameSavesIndex(null)
  private readonly store: RoutedSaveStore
  private readonly ready: Promise<void>
  private send: Send | null = null
  private replies = new Map<string, Promise<Reply>>()
  private queue: Promise<unknown> = Promise.resolve()
  private pending = new Set<string>()
  private busy: GameSavesStatus['busy'] = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopActivity: (() => void) | null = null
  private elapsedFrames = 0
  private lastFrames = 0
  private stableTicks = 0
  private ticks = 0
  private waiting: SaveWaitReason | null = null
  private activity = true
  private fingerprintAtSave = ''

  constructor(private readonly env: GameSavesEnv) {
    this.store = new RoutedSaveStore({ game: env.backend, app: env.appStore }, env.log)
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    try {
      this.settings = parseGameSavesSettings(await this.env.backend.readSettings())
    } catch (error) {
      this.env.log.fail('读取存档设置失败', error)
    }
    await this.store.apply(this.settings)
    this.refreshIndex()
  }

  /** 合并视图：自动、快速列表分别取自当前所在位置 */
  private refreshIndex(): void {
    this.index = { version: 1, revision: this.index.revision + 1, entries: this.store.entries() }
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  start(): void {
    if (this.timer) return
    this.lastFrames = this.env.frames()
    this.fingerprintAtSave = this.env.fingerprint()
    this.stopActivity = this.env.onActivity(() => {
      this.activity = true
    })
    this.timer = setInterval(() => void this.ready.then(() => this.tick()), TICK_MS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopActivity?.()
    this.stopActivity = null
    this.send = null
  }

  disconnected(): void {
    this.send = null
  }

  status(): GameSavesStatus {
    const intervalFrames = this.settings.intervalMin * 60 * FPS
    return {
      enabled: this.settings.enabled,
      nextDueInMs: this.settings.enabled ? Math.round((Math.max(0, intervalFrames - this.elapsedFrames) / FPS) * 1000) : null,
      counting: this.settings.enabled && this.env.active(),
      waiting: this.settings.enabled ? this.waiting : null,
      busy: this.busy,
      offline: this.store.offline(),
    }
  }

  snapshot(): GameSavesSnapshot {
    return { settings: this.settings, index: this.index, status: this.status(), versionId: this.env.versionId() }
  }

  /** Web 端经 GameLink 发来的命令；状态与变更推送都回到这条连接 */
  handle(message: GameLinkMessage, send: Send): boolean {
    if (message.type !== 'saves.cmd') return false
    this.send = send
    void this.execute(message, send)
    return true
  }

  /** 局内浮层直接调用；不占用 GameLink 的回传通道 */
  request(message: GameLinkMessage, send: Send): void {
    if (message.type !== 'saves.cmd') return
    void this.execute(message, send)
  }

  /** 快速存档是否开启（快捷键据此决定是否拦截按键）；设置读取完成前为 false */
  quickHotkeysEnabled(): boolean {
    return this.settings.quickEnabled
  }

  /** 快速存档快捷键：结果只在游戏画面提示 */
  hotkey(action: 'save' | 'load', slot: number): void {
    if (!isQuickSlot(slot) || !this.settings.quickEnabled) return
    void this.ready.then(async () => {
      const key = `quick-${slot}`
      if (action === 'save' && this.pending.has(key)) return
      try {
        if (action === 'save') await this.enqueue(key, 'save', () => this.saveQuick(slot, false, 'hotkey'))
        else await this.enqueue(null, 'load', () => this.load(quickEntryId(slot), false, 'hotkey'))
      } catch (error) {
        if (error instanceof GameSavesError && error.code === 'busy') this.env.toast.result('failure', error.message)
      }
    })
  }

  private execute(message: Cmd, send: Send): Promise<Reply> {
    const cached = this.replies.get(message.reqId)
    if (cached) {
      void cached.then(send)
      return cached
    }
    const reply = this.run(message).then(
      (result): Reply => ({ type: 'saves.reply', reqId: message.reqId, ok: true, snapshot: this.snapshot(), result }),
      (error): Reply => ({
        type: 'saves.reply',
        reqId: message.reqId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof GameSavesError ? error.code : 'failed',
        reason: error instanceof GameSavesError ? error.reason : undefined,
      })
    )
    this.replies.set(message.reqId, reply)
    if (this.replies.size > 200) this.replies.delete(this.replies.keys().next().value!)
    void reply.then(send)
    return reply
  }

  private async run(message: Cmd): Promise<string | null | undefined> {
    await this.ready
    if (message.gameId !== this.env.gameId()) throw new GameSavesError(tNow('saves.error.staleRoom'), 'stale')
    switch (message.op) {
      case 'snapshot':
        if (this.store.offline().length) {
          await this.enqueue(null, 'maintain', async () => {
            if (await this.store.retry()) this.refreshIndex()
          })
        }
        return undefined
      case 'configure':
        await this.enqueue(null, 'maintain', () => this.configure(message.settings, message.expectedRevision))
        return undefined
      case 'save':
        if (message.target === 'quick') {
          if (!isQuickSlot(message.slot)) throw new GameSavesError(tNow('saves.error.invalidSlot'), 'failed')
          const slot = message.slot
          await this.enqueue(`quick-${slot}`, 'save', () => this.saveQuick(slot, !!message.force, message.source ?? 'page'))
        } else await this.enqueue(null, 'save', () => this.saveAuto('manual', !!message.force, 'page'))
        return undefined
      case 'load':
        await this.enqueue(null, 'load', () => this.load(message.entryId, !!message.allowVersionMismatch, message.source ?? 'page'))
        return undefined
      case 'delete':
        await this.enqueue(null, 'save', () => this.remove(message.entryId))
        return undefined
      case 'clear':
        await this.enqueue(null, 'save', () => this.clear(message.list))
        return undefined
      case 'thumb': {
        const entry = this.find(message.entryId)
        return entry?.hasThumb ? this.store.store(entry.list).readThumb(entry.list, entry.id) : null
      }
    }
  }

  /**
   * 串行执行；读档进行中拒绝保存；同一 key 已在排队时拒绝重复请求。
   * `maintain`（重读位置、改设置）不受读档限制，排在读档之后执行，避免与写入交错。
   */
  private enqueue<T>(key: string | null, kind: 'save' | 'load' | 'maintain', task: () => Promise<T>): Promise<T> {
    if (kind === 'save' && this.busy?.op === 'load') return Promise.reject(new GameSavesError(tNow('saves.error.loading'), 'busy'))
    if (key && this.pending.has(key)) return Promise.reject(new GameSavesError(tNow('saves.error.savingSlot'), 'busy'))
    if (key) this.pending.add(key)
    const run = this.queue.then(task)
    this.queue = run.catch(() => {})
    void run.catch(() => {}).finally(() => key && this.pending.delete(key))
    return run
  }

  private find(entryId: string): GameSaveEntry | undefined {
    return isGameSaveEntryId(entryId) ? this.index.entries.find((e) => e.id === entryId) : undefined
  }

  private async configure(raw: GameSavesSettings, expectedRevision: number): Promise<void> {
    const issue = validateGameSavesSettings(raw)
    if (issue) throw new GameSavesError(tNow(issue.key, issue.params), 'failed')
    if (expectedRevision !== this.settings.revision) throw new GameSavesError(tNow('saves.error.settingsStale'), 'stale')
    const prev = this.settings
    const parsed = parseGameSavesSettings(raw)
    const next = { ...parsed, revision: Math.max(prev.revision + 1, parsed.revision) }
    await this.env.backend.writeSettings(next)
    this.settings = next
    if (next.intervalMin !== prev.intervalMin || next.enabled !== prev.enabled) this.resetTimer()
    if (next.autoStorage !== prev.autoStorage || next.quickStorage !== prev.quickStorage) {
      await this.store.apply(next)
      this.refreshIndex()
      this.env.log.info(`存档位置：自动存档${placeLabel[next.autoStorage]}，快速存档${placeLabel[next.quickStorage]}`)
    }
    if (next.maxCount < prev.maxCount) await this.rotate().catch((error) => this.env.log.fail('调小最多份数后轮换失败', error))
    this.env.log.info(`更新自动存档设置：${next.enabled ? '开启' : '关闭'}，间隔 ${next.intervalMin} 分钟，最多 ${next.maxCount} 份`)
    this.notifyChanged()
  }

  private async rotate(): Promise<void> {
    const removed = planRotation(this.index, this.settings.maxCount)
    if (!removed.length) return
    const gone = new Set(removed)
    await this.commit(this.index.entries.filter((e) => !gone.has(e.id)))
    for (const id of removed) await this.store.store('auto').removeEntry('auto', id)
    this.env.log.info(`轮换删除 ${removed.length} 份最早的自动存档`)
  }

  private async commit(entries: GameSaveEntry[]): Promise<void> {
    await this.store.commit(entries)
    this.refreshIndex()
  }

  private async write(
    list: GameSaveList,
    id: string,
    tag: GameSaveTag,
    opts: { unsafe: boolean; slot?: number; captured?: { json: string; meta: SaveMeta }; thumb?: string | null }
  ): Promise<GameSaveEntry> {
    const store = this.store.store(list)
    const thumb = opts.thumb !== undefined ? opts.thumb : this.env.thumb()
    const { json, meta } = opts.captured ?? this.env.capture()
    const data = await gzipText(json)
    const previous = this.index.entries.find((e) => e.id === id)
    const restore = previous ? await this.backupEntry(previous) : null
    const entry: GameSaveEntry = {
      id,
      list,
      ...(list === 'quick' ? { slot: opts.slot } : {}),
      tag,
      unsafe: opts.unsafe,
      savedAt: this.env.now(),
      ...meta,
      bytes: data.byteLength,
      hasThumb: !!thumb,
    }
    try {
      await store.writeEntry(list, id, data, thumb)
      await this.commit([...this.index.entries.filter((e) => e.id !== id), entry])
    } catch (error) {
      if (restore) await restore()
      else await store.removeEntry(list, id).catch(() => {})
      throw error
    }
    if (list === 'auto') await this.rotate()
    return entry
  }

  /** 覆盖快速存档前读出旧内容；索引提交失败时写回，槽位保持保存前的存档 */
  private async backupEntry(entry: GameSaveEntry): Promise<(() => Promise<void>) | null> {
    const store = this.store.store(entry.list)
    try {
      const data = await store.readEntry(entry.list, entry.id)
      const thumb = entry.hasThumb ? await store.readThumb(entry.list, entry.id) : null
      return () => store.writeEntry(entry.list, entry.id, data, thumb).catch((error) => this.env.log.fail(`写回旧存档失败：${listLabel(entry)}`, error))
    } catch (error) {
      this.env.log.warn(`覆盖前读取旧存档失败：${listLabel(entry)}`, error)
      return null
    }
  }

  /** 统一包装一次保存：截图在提示出现前完成，失败时提示并记日志 */
  private async saving<T>(opts: { label: string; source: GameSaveSource }, body: (thumb: string | null) => Promise<T>): Promise<T> {
    const started = this.env.now()
    const thumb = this.env.thumb()
    this.env.toast.pending(tNow('saves.toast.saving'))
    this.busy = { op: 'save' }
    this.pushStatus()
    try {
      const result = await body(thumb)
      this.env.toast.result('success', opts.label)
      return result
    } catch (error) {
      this.env.toast.result('failure', tNow('saves.toast.saveFailed'))
      this.env.log.fail(`保存失败（${sourceLabel[opts.source]}）`, error)
      throw error
    } finally {
      this.busy = null
      this.pushStatus()
      this.env.log.info(`保存结束（${sourceLabel[opts.source]}），耗时 ${this.env.now() - started} ms`)
    }
  }

  private checkSafety(force: boolean, source: GameSaveSource): boolean {
    const safety = this.env.safety()
    if (safety.ok) return false
    if (force) return true
    const message = tNow('saves.error.unsafe', { reason: tNow(saveWaitReasonKey(safety.reason)) })
    if (source === 'hotkey') this.env.toast.result('failure', message)
    throw new GameSavesError(message, 'unsafe', safety.reason)
  }

  private async saveAuto(tag: 'manual' | 'auto', force: boolean, source: GameSaveSource): Promise<void> {
    const unsafe = this.checkSafety(force, source)
    const entry = await this.saving({ label: tNow(source === 'timer' ? 'saves.toast.autoSaved' : 'saves.toast.saved'), source }, (thumb) =>
      this.write('auto', newAutoEntryId(this.env.now()), tag, { unsafe, thumb })
    )
    this.env.log[unsafe ? 'warn' : 'info'](`已保存${unsafe ? '（非安全时刻）' : ''}：${listLabel(entry)}，${entry.mapName || `地图 ${entry.mapId}`}`)
    this.markAutoSaved()
    this.notifyChanged()
  }

  private async saveQuick(slot: number, force: boolean, source: GameSaveSource): Promise<void> {
    if (!this.settings.quickEnabled) throw new GameSavesError(tNow('saves.error.quickOff'), 'failed')
    const unsafe = this.checkSafety(force, source)
    const entry = await this.saving({ label: tNow('saves.toast.savedSlot', { slot }), source }, (thumb) =>
      this.write('quick', quickEntryId(slot), 'quick', { unsafe, slot, thumb })
    )
    this.env.log[unsafe ? 'warn' : 'info'](`已保存${unsafe ? '（非安全时刻）' : ''}：${listLabel(entry)}，${entry.mapName || `地图 ${entry.mapId}`}`)
    this.notifyChanged()
  }

  private async load(entryId: string, allowVersionMismatch: boolean, source: GameSaveSource): Promise<void> {
    const entry = this.find(entryId)
    const failure = (message: string, code: GameSavesErrorCode) => {
      if (source === 'hotkey') this.env.toast.result('failure', message)
      return new GameSavesError(message, code)
    }
    if (!entry) throw failure(entryId.startsWith('quick-') ? tNow('saves.error.slotEmpty', { slot: entryId.slice(6) }) : tNow('saves.error.missing'), 'empty')
    if (entry.versionId && entry.versionId !== this.env.versionId() && !allowVersionMismatch) {
      throw failure(tNow(source === 'hotkey' ? 'saves.error.versionHotkey' : 'saves.error.version'), 'versionMismatch')
    }
    const started = this.env.now()
    this.busy = { op: 'load', entryId }
    this.pushStatus()
    this.env.toast.pending(tNow('saves.toast.loading'))
    try {
      const json = await gunzipText(await this.store.store(entry.list).readEntry(entry.list, entry.id))
      const backup = this.env.inGame() ? this.env.capture().json : null
      this.env.beforeLoad()
      try {
        this.env.restore(json)
      } catch (error) {
        if (backup) {
          try {
            this.env.restore(backup)
          } catch (rollbackError) {
            this.env.log.fail('读档失败且无法恢复读档前进度，请从游戏存档或存档列表重新读取', rollbackError)
          }
        }
        throw error
      }
      this.env.afterLoad()
      this.markAutoSaved()
      this.env.toast.result('success', entry.list === 'quick' ? tNow('saves.toast.loadedSlot', { slot: entry.slot ?? 0 }) : tNow('saves.toast.loaded'))
      this.env.log.info(`已读档（${sourceLabel[source]}）：${listLabel(entry)}，耗时 ${this.env.now() - started} ms`)
      this.notifyChanged()
    } catch (error) {
      this.env.toast.result('failure', tNow('saves.toast.loadFailed'))
      this.env.log.fail(`读档失败（${sourceLabel[source]}）：${listLabel(entry)}`, error)
      throw error instanceof GameSavesError
        ? error
        : new GameSavesError(tNow('saves.error.loadFailed', { reason: error instanceof Error ? error.message : String(error) }), 'failed')
    } finally {
      this.busy = null
      this.pushStatus()
    }
  }

  private async remove(entryId: string): Promise<void> {
    const entry = this.find(entryId)
    if (!entry) throw new GameSavesError(tNow('saves.error.missing'), 'empty')
    await this.commit(this.index.entries.filter((e) => e.id !== entry.id))
    await this.store.store(entry.list).removeEntry(entry.list, entry.id)
    this.env.log.info(`已删除：${listLabel(entry)}`)
    this.notifyChanged()
  }

  private async clear(list: GameSaveList): Promise<void> {
    const removed = this.index.entries.filter((e) => e.list === list)
    if (!removed.length) return
    await this.commit(this.index.entries.filter((e) => e.list !== list))
    for (const entry of removed) await this.store.store(list).removeEntry(list, entry.id)
    this.env.log.info(`已清空${list === 'quick' ? '快速存档' : '自动存档'}：${removed.length} 份`)
    this.notifyChanged()
  }

  private resetTimer(): void {
    this.elapsedFrames = 0
    this.stableTicks = 0
    this.lastFrames = this.env.frames()
  }

  private markAutoSaved(): void {
    this.resetTimer()
    this.activity = false
    this.fingerprintAtSave = this.env.fingerprint()
  }

  private setWaiting(reason: SaveWaitReason | null): void {
    if (reason === this.waiting) return
    if (reason) this.env.log.info(`自动存档等待中：${translate(MESSAGES.zh, saveWaitReasonKey(reason))}`)
    else if (this.waiting) this.env.log.info('自动存档等待结束')
    this.waiting = reason
    this.pushStatus()
  }

  /** 每 500ms 一次：累计有效运行帧，到期后等待连续 1 秒的安全时刻 */
  tick(): void {
    const frames = this.env.frames()
    const delta = frames - this.lastFrames
    this.lastFrames = frames
    if (++this.ticks % STATUS_EVERY_TICKS === 0) this.pushStatus()
    if (!this.settings.enabled || !this.env.active()) {
      this.stableTicks = 0
      return
    }
    if (delta > 0 && delta <= MAX_TICK_FRAMES) this.elapsedFrames += delta
    if (this.elapsedFrames < this.settings.intervalMin * 60 * FPS) return this.setWaiting(null)
    if (this.busy || this.pending.size) return this.setWaiting('busy')
    if (!this.activity && this.env.fingerprint() === this.fingerprintAtSave) {
      this.stableTicks = 0
      return this.setWaiting('idle')
    }
    const safety = this.env.safety()
    if (!safety.ok) {
      this.stableTicks = 0
      return this.setWaiting(safety.reason)
    }
    if (this.store.offline().includes('auto')) {
      this.stableTicks = 0
      return this.setWaiting('offline')
    }
    this.setWaiting(null)
    if (++this.stableTicks < STABLE_TICKS) return
    this.stableTicks = 0
    // 失败后从头计时，避免存放位置持续不可用时每秒重试、反复提示；入队后才变得不可保存时保留已累计的时间，安全后再存
    void this.enqueue('auto-timer', 'save', () => this.saveAuto('auto', false, 'timer')).catch((error) => {
      if (error instanceof GameSavesError && error.code === 'unsafe') this.stableTicks = 0
      else this.resetTimer()
    })
  }

  private pushStatus(): void {
    const status = this.status()
    window.dispatchEvent(new CustomEvent(GAME_SAVES_STATUS_EVENT, { detail: status }))
    this.send?.({ type: 'saves.status', gameId: this.env.gameId(), status })
  }

  private notifyChanged(): void {
    const snapshot = this.snapshot()
    window.dispatchEvent(new CustomEvent(GAME_SAVES_CHANGED_EVENT, { detail: snapshot }))
    this.send?.({ type: 'saves.changed', gameId: this.env.gameId(), snapshot })
  }
}
