import type { Dispatch, SetStateAction } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useNotification } from '@/components/notification/useNotification'
import { readApiErrorMessage } from '@/lib/api-error'
import { startServerShellDownload } from '@/lib/downloads/server-sync'

import type { Status } from './types'

type Options = {
  status: Status | null
  shellSource: string
  setShellSource: Dispatch<SetStateAction<string>>
  setBusy: Dispatch<SetStateAction<boolean>>
  refresh: () => Promise<Status | null>
  pick: (kind: 'folder' | 'app' | 'game') => Promise<string | null>
}

export function useDashboardActions({ status, shellSource, setShellSource, setBusy, refresh, pick }: Options) {
  const notify = useNotification()
  const confirm = useConfirm()
  async function chooseShell() {
    const path = await pick('app')
    if (!path) return
    await bindShell(path)
  }

  async function bindShell(path: string) {
    const next = path.trim()
    setBusy(true)
    try {
      const res = await fetch('/api/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shellSource: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '保存壳源失败'))
        return
      }
      setShellSource(next)
      notify.success('已选壳源')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function copyPath(text: string) {
    const next = text.trim()
    if (!next) return
    try {
      await navigator.clipboard.writeText(next)
      notify.success('已复制')
    } catch {
      notify.error('复制失败')
    }
  }

  async function saveGameRemark(nextRemark: string) {
    if (!status?.config?.gameRoot) return
    setBusy(true)
    try {
      const res = await fetch('/api/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: nextRemark }),
      })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '备注保存失败'))
        return
      }
      notify.success(nextRemark.trim() ? '备注已更新' : '已清除备注')
      await refresh()
    } catch {
      notify.error('备注保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeGame(path: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/status', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameRoot: path }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '移除失败'))
        return
      }
      notify.success('已从库中移除')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function installShell() {
    setBusy(true)
    try {
      const res = await fetch('/api/shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shellSource }),
      })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '装壳失败'))
        return
      }
      notify.success([data.created ? '已建壳' : '复用壳', data.relinked ? '已重链' : '链已最新'].join(' · '))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function fetchLatestShell() {
    const upgrading = !!(status && 'installedShell' in status && status.installedShell)
    const ok = await confirm({
      title: upgrading ? '升级到最新 NW.js？' : '下载最新 NW.js？',
      description: upgrading
        ? '当前共用壳已可启动游戏，一般不必升级。确认后在后台下载约百兆包并替换工具 data/shell 中的壳，进度见右上角下载中心；中断后再次下载会接着上次进度。Windows 上游戏运行中替换会失败，退出游戏后再点一次即可。'
        : '将在后台从 nwjs.io 下载当前平台最新包并安装到工具 data/shell（约百兆），进度见右上角下载中心；中断后再次下载会接着上次进度。也可在设置里指定本地壳源后点「安装」。',
      confirmLabel: upgrading ? '下载并升级' : '下载并安装',
      confirmVariant: 'accent',
      onConfirm: async () => {
        try {
          await startServerShellDownload()
        } catch (err) {
          notify.error(err instanceof Error ? err.message : '下载 / 升级壳失败')
        }
      },
    })
    if (!ok) return
  }

  async function uninstallShell() {
    setBusy(true)
    try {
      const res = await fetch('/api/shell', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '卸载壳失败'))
        return
      }
      const n = Array.isArray(data.removed) ? data.removed.length : 0
      notify.success(n ? `已卸载共用壳（${n} 处）` : '没有可卸载的壳')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /** `quiet`: auto update shows its own toast; errors still surface */
  async function injectPlugins(opts?: { quiet?: boolean }): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch('/api/plugins', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '安装插件失败'))
        return false
      }
      const copied = Array.isArray(data.copied) ? data.copied.length : 0
      if (!opts?.quiet) notify.success(data.pluginsJsUpdated ? `已安装插件（缓存 ${copied} 个）` : copied ? `插件已更新（缓存 ${copied} 个）` : '插件已是最新')
      await refresh()
      return true
    } catch {
      notify.error('安装插件失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function clearPlugins() {
    setBusy(true)
    try {
      const res = await fetch('/api/plugins', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, '清除插件失败'))
        return
      }
      const removed = Array.isArray(data.removedFiles) ? data.removedFiles.length : 0
      notify.success(removed ? `已清除插件与 ${removed} 个文件` : '没有可清除的插件')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return { chooseShell, bindShell, copyPath, saveGameRemark, removeGame, installShell, fetchLatestShell, uninstallShell, injectPlugins, clearPlugins }
}
