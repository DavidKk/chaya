'use client'

/**
 * 页面下载任务存储（模块级单例）：服务端任务由 server-sync 写入，浏览器任务由 browser-tasks 写入。
 * 列表是不可变数组；浏览器任务需要用户手势的步骤（打开下载 / 选文件）放侧表，由游戏卡片承接。
 */
import { useSyncExternalStore } from 'react'

import { nextRate, type RateSample } from '@/lib/downloads/rate'
import { type BrowserDownloadPhase, downloadPercent, type DownloadStatus, type ServerDownloadKind, type ServerDownloadPhase } from '@/lib/downloads/types'

export type DownloadItem = {
  /** `srv:<jobId>` | `web:<uuid>` */
  id: string
  channel: 'server' | 'browser'
  kind: ServerDownloadKind
  status: DownloadStatus
  phase: ServerDownloadPhase | BrowserDownloadPhase
  version?: string
  gameId?: string
  gameName?: string
  receivedBytes?: number
  totalBytes?: number
  resumedFrom?: number
  /** 浏览器写入阶段按文件数 */
  doneCount?: number
  totalCount?: number
  /** 字节/秒，平滑后 */
  rate?: number
  error?: string
  /** 服务重启导致的本页合成中断项（文案走 i18n） */
  interrupted?: boolean
  /** 浏览器等待选文件时期望的压缩包名 */
  archiveName?: string
  startedAt: number
  finishedAt?: number
}

type ActionResult = void | Promise<void>

/** 失败时抛错，由调用处提示 */
export type DownloadActions = {
  openDownload?(): ActionResult
  pickFile?(): ActionResult
}

const MAX_BROWSER_ITEMS = 50
/** 本页自己维护的结束项（浏览器任务、服务重启合成的中断项）保留时长，与服务端一致 */
export const LOCAL_FINISHED_TTL_MS = 60 * 60 * 1000
const EMPTY: DownloadItem[] = []

let items: DownloadItem[] = EMPTY
const actions = new Map<string, DownloadActions>()
const samples = new Map<string, RateSample>()
const notified = new Set<string>()
const listeners = new Set<() => void>()
const finishListeners = new Set<(item: DownloadItem) => void>()
const openListeners = new Set<() => void>()
const expiry = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function withRate(prev: DownloadItem | undefined, next: DownloadItem): DownloadItem {
  if (next.status !== 'running' || next.receivedBytes == null) {
    samples.delete(next.id)
    return next.status === 'running' ? next : { ...next, rate: undefined }
  }
  if (prev && prev.phase !== next.phase) samples.delete(next.id)
  const sample = nextRate(samples.get(next.id), next.receivedBytes, Date.now())
  samples.set(next.id, sample)
  return { ...next, rate: sample.rate }
}

function capBrowserItems(list: DownloadItem[]): DownloadItem[] {
  const browser = list.filter((i) => i.channel === 'browser')
  if (browser.length <= MAX_BROWSER_ITEMS) return list
  const drop = new Set(
    browser
      .filter((i) => i.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))
      .slice(0, browser.length - MAX_BROWSER_ITEMS)
      .map((i) => i.id)
  )
  for (const id of drop) forget(id)
  return list.filter((i) => !drop.has(i.id))
}

function forget(id: string): void {
  actions.delete(id)
  samples.delete(id)
  clearTimeout(expiry.get(id))
  expiry.delete(id)
}

export type UpsertOptions = {
  /** 页面第一份快照：终态项只建立基线，不触发结束事件 */
  baseline?: boolean
}

/** 新增或整体替换一项；终态项按"已通知 ID 集合"只触发一次结束事件 */
export function upsertDownload(item: DownloadItem, nextActions?: DownloadActions, opts: UpsertOptions = {}): void {
  const index = items.findIndex((i) => i.id === item.id)
  const prev = index >= 0 ? items[index] : undefined
  const next = withRate(prev, item)
  const list = index >= 0 ? items.map((i, n) => (n === index ? next : i)) : [next, ...items]
  items = capBrowserItems(list)
  if (nextActions) actions.set(item.id, nextActions)

  let finished: DownloadItem | undefined
  if (next.status !== 'running' && !notified.has(next.id)) {
    notified.add(next.id)
    if (!opts.baseline && (!prev || prev.status === 'running')) finished = next
  }
  if (next.status === 'running') notified.delete(next.id)
  emit()
  if (finished) for (const l of finishListeners) l(finished)
}

export function patchDownload(id: string, patch: Partial<DownloadItem>): void {
  const prev = items.find((i) => i.id === id)
  if (prev) upsertDownload({ ...prev, ...patch, id })
}

export function setDownloadActions(id: string, next: DownloadActions): void {
  actions.set(id, next)
  emit()
}

export function removeDownload(id: string): void {
  if (!items.some((i) => i.id === id)) return
  items = items.filter((i) => i.id !== id)
  forget(id)
  emit()
}

/** 结束项到期后从本页列表移除 */
export function expireDownload(id: string, ms = LOCAL_FINISHED_TTL_MS): void {
  clearTimeout(expiry.get(id))
  expiry.set(
    id,
    setTimeout(() => removeDownload(id), ms)
  )
}

export function getDownloads(): DownloadItem[] {
  return items
}

export function getDownloadActions(id: string): DownloadActions | undefined {
  return actions.get(id)
}

export function useDownloads(): DownloadItem[] {
  return useSyncExternalStore(subscribe, getDownloads, () => EMPTY)
}

export function useDownloadActions(id: string): DownloadActions | undefined {
  return useSyncExternalStore(
    subscribe,
    () => actions.get(id),
    () => undefined
  )
}

export function useServerDownloadRunning(kind: ServerDownloadKind): boolean {
  return useSyncExternalStore(
    subscribe,
    () => items.some((i) => i.channel === 'server' && i.kind === kind && i.status === 'running'),
    () => false
  )
}

/** `phases` 给定时只看这些阶段（如只在写游戏目录的阶段禁用连接） */
export function useBrowserDownloadRunning(kind: ServerDownloadKind, gameId: string | undefined, phases?: readonly BrowserDownloadPhase[]): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      Boolean(gameId) &&
      items.some(
        (i) => i.channel === 'browser' && i.kind === kind && i.gameId === gameId && i.status === 'running' && (!phases || phases.includes(i.phase as BrowserDownloadPhase))
      ),
    () => false
  )
}

/** 该游戏正在等待用户选压缩包的浏览器任务 */
export function useBrowserAwaitFile(kind: ServerDownloadKind, gameId: string | undefined): DownloadItem | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (gameId ? items.find((i) => i.channel === 'browser' && i.kind === kind && i.gameId === gameId && i.status === 'running' && i.phase === 'awaitFile') : undefined),
    () => undefined
  )
}

export function onDownloadFinished(listener: (item: DownloadItem) => void): () => void {
  finishListeners.add(listener)
  return () => {
    finishListeners.delete(listener)
  }
}

export function requestDownloadCenterOpen(): void {
  for (const l of openListeners) l()
}

export function onDownloadCenterOpenRequest(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

export function itemPercent(item: DownloadItem): number | undefined {
  if (item.status === 'done') return 100
  if (item.totalCount != null && item.phase === 'write') return downloadPercent(item.doneCount, item.totalCount)
  if (item.phase === 'download' || item.phase === 'read') return downloadPercent(item.receivedBytes, item.totalBytes)
  return undefined
}

export function resetDownloadsForTest(): void {
  items = EMPTY
  actions.clear()
  samples.clear()
  for (const t of expiry.values()) clearTimeout(t)
  expiry.clear()
  notified.clear()
  listeners.clear()
  finishListeners.clear()
  openListeners.clear()
}
