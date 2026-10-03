'use client'

/**
 * 浏览器模式 Windows 装壳任务编排（不依赖 React）：进度在右上角下载中心，
 * 用户离开游戏库页后任务照样落盘，结束后回写游戏库。
 */
import { SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { type BrowserTaskHandle, startBrowserDownload } from '@/lib/downloads/browser-tasks'

import { CLOUD_LIBRARY_CHANGED_EVENT, type CloudLibraryEntry, cloudLibraryStorage } from './cloud-library'
import { inspectCloudGame } from './cloud-prepare-game'
import {
  cacheNwZip,
  CorruptNwZipError,
  dropCachedNwZip,
  isCompleteWinShell,
  openOfficialNwDownload,
  pickLocalNwZip,
  prepareWinShell,
  writeShellLaunchers,
  writeWinShell,
} from './nw-shell-fsa'

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
}

/** 选文件时顺带确认目录写权限（在用户点击里调用） */
async function ensureWritePermission(dir: FileSystemDirectoryHandle): Promise<void> {
  const handle = dir as PermissionHandle
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') return
  if ((await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('需要授权访问游戏目录，请重新点击操作或添加游戏。')
}

/** 任务结束后重新检查；条目还在游戏库里才写回（期间被移除就不加回来） */
async function writeBack(id: string): Promise<void> {
  const entries = await cloudLibraryStorage()
  const current = entries.find((e) => e.item.id === id)
  if (!current) return
  const game = { ...(await inspectCloudGame(current.game)), footprint: undefined }
  await cloudLibraryStorage(entries.map((e) => (e.item.id === id ? { ...e, game, item: { ...e.item, hasShell: !!game.existingShell } } : e)))
  window.dispatchEvent(new Event(CLOUD_LIBRARY_CHANGED_EVENT))
}

export type CloudShellTask = BrowserTaskHandle & {
  /** 进入「等待用户选文件」时 resolve true；不需要选文件就结束时 resolve false */
  needsFile: Promise<boolean>
}

/**
 * 调用方须在点击处理的第一行 `await requireCloudPermission(game)`（任何其它 await 之前）。
 * 返回 `locked` 表示另一个页面正在为此游戏安装壳。
 */
export async function startCloudShellTask(entry: CloudLibraryEntry): Promise<CloudShellTask | { error: 'locked' }> {
  const { game, item } = entry
  let markNeedsFile!: (needs: boolean) => void
  const needsFile = new Promise<boolean>((resolve) => (markNeedsFile = resolve))

  const started = await startBrowserDownload({
    kind: 'nw-shell',
    gameId: item.id,
    gameName: item.remark || item.name,
    lockKey: `chaya-shell:${item.id}`,
    onDone: () => writeBack(item.id),
    run: async (ctl) => {
      if (await isCompleteWinShell(game.picked, SHELL_WIN_DIR_NAME)) {
        await writeShellLaunchers(game.picked, 'win')
        return
      }
      const plan = await prepareWinShell()
      ctl.update({ version: plan.version })
      let file = plan.cached
      let fromCache = !!file
      for (;;) {
        if (!file) {
          openOfficialNwDownload(plan.url)
          markNeedsFile(true)
          file = await ctl.waitForFile({
            archiveName: plan.archiveName,
            openDownload: () => openOfficialNwDownload(plan.url),
            pickFile: async () => {
              await ensureWritePermission(game.picked)
              return pickLocalNwZip(plan.archiveName)
            },
          })
          fromCache = false
        }
        const release = await ctl.enterIoQueue()
        try {
          ctl.update({ phase: 'read', receivedBytes: 0, totalBytes: file.size })
          const zip = new Uint8Array(await file.arrayBuffer())
          ctl.update({ phase: 'read', receivedBytes: zip.byteLength, totalBytes: zip.byteLength })
          if (!fromCache) await cacheNwZip(plan.version, plan.fileKey, zip)
          ctl.update({ phase: 'write', receivedBytes: undefined, totalBytes: undefined })
          await writeWinShell(game.picked, zip, { onProgress: (p) => ctl.update({ phase: 'write', doneCount: p.done, totalCount: p.total }) })
          break
        } catch (e) {
          if (!(e instanceof CorruptNwZipError)) throw e
          await dropCachedNwZip(plan.version, plan.fileKey)
          file = null
        } finally {
          release()
        }
      }
      await writeShellLaunchers(game.picked, 'win')
    },
  })
  if ('error' in started) return started
  void started.done.then(() => markNeedsFile(false))
  return { ...started, needsFile }
}
