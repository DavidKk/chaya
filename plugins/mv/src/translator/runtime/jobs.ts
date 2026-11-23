import { charCount, lineCount, shouldTranslate } from '@/services/translate/text-classify'

import type { TranslationStore } from './store'
import type { TranslateItem } from './translator'

export function createPluginTranslationJob(store: TranslationStore, translate: (texts: string[], signal: AbortSignal) => Promise<TranslateItem[]>) {
  let abort: AbortController | null = null
  let loop: Promise<void> | null = null
  let disposed = false
  const job = {
    status: 'idle',
    startedAt: null as number | null,
    sessionDone: 0,
    liveStatus: '',
    error: null as string | null,
    logs: [] as Array<{ id: number; at: number; level: string; text: string }>,
  }
  let logId = 0
  function log(level: string, text: string) {
    job.logs.push({ id: ++logId, at: Date.now(), level, text })
    job.logs = job.logs.slice(-120)
  }
  let scanning: Promise<Awaited<ReturnType<typeof scan>>> | null = null
  let progress: ReturnType<typeof emptyProgress> | null = null
  let scannedRevision = -1
  function emptyProgress(total: number) {
    return {
      hasSeed: total > 0,
      total,
      done: 0,
      missing: 0,
      needCount: 0,
      skipCount: 0,
      needChars: 0,
      skipChars: 0,
      missingChars: 0,
      doneChars: 0,
      lines: 0,
      batchSize: 40,
      batchesLeft: 0,
    }
  }
  async function scan() {
    const revision = store.revision()
    const keys = Object.keys(store.seed())
    const next = emptyProgress(keys.length)
    progress = next
    let yieldedAt = Date.now()
    for (const src of keys) {
      if (disposed) break
      // Large source inventories must leave time for rendering, RPC and extraction.
      if (Date.now() - yieldedAt >= 8) {
        await new Promise((resolve) => setTimeout(resolve, 16))
        yieldedAt = Date.now()
      }
      if (disposed) break
      next.lines += lineCount(src)
      const chars = charCount(src)
      if (!shouldTranslate(src)) {
        next.skipCount++
        next.skipChars += chars
        continue
      }
      next.needCount++
      next.needChars += chars
      if (store.lookup(src)) {
        next.done++
        next.doneChars += chars
      } else {
        next.missing++
        next.missingChars += chars
      }
    }
    next.batchesLeft = Math.ceil(next.missing / next.batchSize)
    if (!disposed && revision === store.revision()) scannedRevision = revision
    return next
  }
  async function snapshot() {
    await store.load()
    if (!disposed && !scanning && scannedRevision !== store.revision())
      scanning = scan()
        .catch((error: unknown) => {
          job.status = 'error'
          job.error = error instanceof Error ? error.message : String(error)
          log('fail', `Inventory scan failed: ${job.error}`)
          scannedRevision = store.revision()
          return progress!
        })
        .finally(() => {
          scanning = null
        })
    // Small inventories finish inline; large ones publish partial counts without holding RPC open.
    if (scanning) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          scanning,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 16)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    const preparing = Boolean(scanning) || scannedRevision !== store.revision()
    const current = progress ?? emptyProgress(Object.keys(store.seed()).length)
    return { ...current, batchesLeft: Math.ceil(current.missing / current.batchSize), ...(preparing ? { preparing: true } : {}), job: { ...job, logs: [...job.logs] } }
  }
  async function start() {
    if (disposed) throw new Error('翻译插件已更新，请重试')
    if (loop) return snapshot()
    const before = await snapshot()
    if (!before.hasSeed) throw new Error('请先抽取游戏文本')
    job.status = 'running'
    job.error = null
    job.startedAt = Date.now()
    job.sessionDone = 0
    const keys = Object.keys(store.seed()).filter(shouldTranslate)
    loop = (async () => {
      try {
        let yieldedAt = Date.now()
        for (const src of keys) {
          if (disposed || job.status !== 'running') break
          if (Date.now() - yieldedAt >= 8) {
            await new Promise((resolve) => setTimeout(resolve, 16))
            yieldedAt = Date.now()
          }
          if (disposed || job.status !== 'running') break
          if (store.lookup(src)) continue
          abort = new AbortController()
          job.liveStatus = `正在翻译：${src.slice(0, 60)}`
          try {
            const items = await translate([src], abort.signal)
            const item = items[0]
            if (item?.zh && item.zh !== src && !item.error && item.status !== 'partial') {
              job.sessionDone++
              log('ok', `Translation complete: ${src} → ${item.zh}`)
            } else log('warn', `Translation failed: ${src} (${item?.error || 'no translation returned'})`)
          } catch (error) {
            if (!abort.signal.aborted) throw error
            if (job.status === 'running' && !disposed) log('info', `Current dialogue takes precedence; retry this item later: ${src}`)
          } finally {
            abort = null
          }
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        if (disposed || job.status !== 'running') return
        // Completion needs a full inventory, while UI progress requests remain nonblocking.
        let after = await snapshot()
        while (!disposed && job.status === 'running' && after.preparing) {
          if (scanning) {
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([
                scanning,
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, 50)
                }),
              ])
            } finally {
              clearTimeout(timer)
            }
          }
          after = await snapshot()
        }
        if (disposed || job.status !== 'running') return
        job.status = after.missing ? 'paused' : 'done'
        job.liveStatus = after.missing ? `已暂停，仍缺 ${after.missing} 条；继续可重试` : '翻译完成'
      } catch (error) {
        job.status = 'error'
        job.error = error instanceof Error ? error.message : '翻译失败'
        job.liveStatus = ''
        log('fail', `Translation stopped: ${job.error}`)
      }
    })().finally(() => {
      loop = null
    })
    return snapshot()
  }
  async function pause() {
    job.status = 'paused'
    abort?.abort()
    return snapshot()
  }
  function dispose() {
    disposed = true
    job.status = 'paused'
    abort?.abort()
  }
  return { snapshot, start, pause, dispose, preempt: () => abort?.abort() }
}
