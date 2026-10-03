'use client'

/**
 * 浏览器任务运行器：游戏级 Web Locks 互斥（跨标签页）、标签页内读写串行、等待用户选文件。
 * 任务状态写入下载存储；离开确认由 DownloadsRuntime 订阅存储统一处理。
 */
import { type DownloadItem, expireDownload, getDownloads, patchDownload, setDownloadActions, upsertDownload } from '@/lib/downloads/store'
import type { DownloadStatus, ServerDownloadKind } from '@/lib/downloads/types'

export type BrowserTaskControl = {
  update(patch: Partial<DownloadItem>): void
  /** 阶段设为 awaitFile 并挂上「打开官方下载 / 选择文件 / 放弃」（由游戏卡片展示）；选中后 resolve，放弃时以 AbortError reject */
  waitForFile<T>(opts: { archiveName: string; openDownload: () => void; pickFile: () => Promise<T> }): Promise<T>
  /** 进入读写前排队（标签页内串行，阶段为 queued），返回出队函数 */
  enterIoQueue(): Promise<() => void>
}

export type BrowserTaskSpec = {
  kind: ServerDownloadKind
  gameId: string
  gameName: string
  lockKey: string
  run(ctl: BrowserTaskControl): Promise<void>
  onDone?(): Promise<void> | void
}

export type BrowserTaskHandle = { id: string; done: Promise<DownloadItem> }

type LockManager = { request(name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void> }

const localLocks = new Set<string>()
let ioTail: Promise<void> = Promise.resolve()

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

async function enterIoQueue(update: (p: Partial<DownloadItem>) => void): Promise<() => void> {
  let release!: () => void
  const mine = new Promise<void>((resolve) => (release = resolve))
  const prev = ioTail
  ioTail = prev.then(() => mine)
  update({ phase: 'queued' })
  await prev
  return release
}

function runTask(id: string, spec: BrowserTaskSpec): Promise<DownloadItem> {
  let status: DownloadStatus = 'running'
  const update = (patch: Partial<DownloadItem>) => {
    if (status === 'running') patchDownload(id, { ...patch, status: 'running' })
  }

  upsertDownload({ id, channel: 'browser', kind: spec.kind, status, phase: 'prepare', gameId: spec.gameId, gameName: spec.gameName, startedAt: Date.now() }, {})

  const ctl: BrowserTaskControl = {
    update,
    enterIoQueue: () => enterIoQueue(update),
    waitForFile: ({ archiveName, openDownload, pickFile }) =>
      new Promise((resolve, reject) => {
        update({ phase: 'awaitFile', archiveName })
        setDownloadActions(id, {
          openDownload,
          abandon: () => {
            setDownloadActions(id, {})
            reject(new DOMException('abandoned', 'AbortError'))
          },
          pickFile: async () => {
            try {
              const picked = await pickFile()
              setDownloadActions(id, {})
              resolve(picked)
            } catch (e) {
              if (!isAbort(e)) throw e
            }
          },
        })
      }),
  }

  const finish = (next: DownloadStatus, error?: string): DownloadItem => {
    status = next
    patchDownload(id, { status: next, error, finishedAt: Date.now(), archiveName: undefined })
    setDownloadActions(id, {})
    expireDownload(id)
    return { ...(getDownloads().find((i) => i.id === id) as DownloadItem) }
  }

  return (async () => {
    try {
      await spec.run(ctl)
      await spec.onDone?.()
      return finish('done')
    } catch (e) {
      if (isAbort(e)) return finish('canceled')
      return finish('error', e instanceof Error ? e.message : String(e))
    }
  })()
}

/** 拿到游戏锁后立即返回任务 ID（不等任务结束）；拿不到返回 `locked` */
export function startBrowserDownload(spec: BrowserTaskSpec): Promise<BrowserTaskHandle | { error: 'locked' }> {
  const id = `web:${crypto.randomUUID()}`
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) {
    if (localLocks.has(spec.lockKey)) return Promise.resolve({ error: 'locked' })
    localLocks.add(spec.lockKey)
    const done = runTask(id, spec).finally(() => localLocks.delete(spec.lockKey))
    return Promise.resolve({ id, done })
  }
  return new Promise((resolve, reject) => {
    locks
      .request(spec.lockKey, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve({ error: 'locked' })
          return
        }
        const done = runTask(id, spec)
        resolve({ id, done })
        await done
      })
      .catch(reject)
  })
}

export function resetBrowserTasksForTest(): void {
  localLocks.clear()
  ioTail = Promise.resolve()
}
