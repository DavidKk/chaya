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
  async function snapshot() {
    await store.load()
    const keys = Object.keys(store.seed())
    const progress = {
      hasSeed: keys.length > 0,
      total: keys.length,
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
    for (const src of keys) {
      progress.lines += lineCount(src)
      const chars = charCount(src)
      if (!shouldTranslate(src)) {
        progress.skipCount++
        progress.skipChars += chars
        continue
      }
      progress.needCount++
      progress.needChars += chars
      if (store.lookup(src)) {
        progress.done++
        progress.doneChars += chars
      } else {
        progress.missing++
        progress.missingChars += chars
      }
    }
    progress.batchesLeft = Math.ceil(progress.missing / progress.batchSize)
    return { ...progress, job: { ...job, logs: [...job.logs] } }
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
        for (const src of keys) {
          if (disposed || job.status !== 'running') break
          if (store.lookup(src)) continue
          abort = new AbortController()
          job.liveStatus = `正在翻译：${src.slice(0, 60)}`
          try {
            const items = await translate([src], abort.signal)
            const item = items[0]
            if (item?.zh && item.zh !== src) {
              job.sessionDone++
              log('ok', `${src.slice(0, 60)} → ${item.zh.slice(0, 60)}`)
            } else log('warn', item?.error || '未得到译文')
          } catch (error) {
            if (!abort.signal.aborted) throw error
            if (job.status === 'running' && !disposed) log('info', '优先处理当前对话，本条稍后可继续补译')
          } finally {
            abort = null
          }
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        const after = await snapshot()
        job.status = after.missing ? 'paused' : 'done'
        job.liveStatus = after.missing ? `已暂停，仍缺 ${after.missing} 条；继续可重试` : '翻译完成'
      } catch (error) {
        job.status = 'error'
        job.error = error instanceof Error ? error.message : '翻译失败'
        job.liveStatus = ''
        log('fail', job.error)
      } finally {
        loop = null
      }
    })()
    return snapshot()
  }
  async function pause() {
    job.status = 'paused'
    abort?.abort()
    if (loop) await loop
    return snapshot()
  }
  function dispose() {
    disposed = true
    job.status = 'paused'
    abort?.abort()
  }
  return { snapshot, start, pause, dispose, preempt: () => abort?.abort() }
}
