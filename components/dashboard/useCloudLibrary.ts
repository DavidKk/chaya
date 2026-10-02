'use client'

import { useEffect, useRef, useState } from 'react'

import { useNotification } from '@/components/notification/useNotification'
import { CLOUD_LIBRARY_CHANGED_EVENT, type CloudLibraryEntry, cloudLibraryStorage, readCloudGameId, requireCloudPermission, selectCloudGameId } from '@/lib/browser/cloud-library'
import {
  clearCloudPlugins,
  type CloudGame,
  configureCloudConnection,
  inspectCloudGame,
  installCloudPlugins,
  installCloudShell,
  selectCloudGame,
} from '@/lib/browser/cloud-prepare-game'

import type { Status } from './types'

export function useCloudLibrary(enabled: boolean, queryId: string | null, selectId: (id: string | null) => void) {
  const [entries, setEntries] = useState<CloudLibraryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const actionInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [macOpen, setMacOpen] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string>()
  const [progress, setProgress] = useState('')
  const notify = useNotification()
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () =>
      cloudLibraryStorage()
        .then((saved) => {
          if (!cancelled) setEntries(saved)
        })
        .catch(() => {
          if (!cancelled) notify.error('无法读取浏览器游戏库，请检查浏览器存储权限。')
        })
        .finally(() => {
          if (!cancelled) setLoaded(true)
        })
    void load()
    window.addEventListener(CLOUD_LIBRARY_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(CLOUD_LIBRARY_CHANGED_EVENT, load)
    }
  }, [enabled, notify])

  const active = entries.find((entry) => entry.item.id === (queryId || readCloudGameId())) ?? entries[0]
  const activeId = active?.item.id ?? null
  useEffect(() => {
    if (enabled && loaded) selectCloudGameId(activeId)
  }, [enabled, loaded, activeId])
  async function save(next: CloudLibraryEntry[]) {
    await cloudLibraryStorage(next)
    setEntries(next)
  }
  async function run(action: () => Promise<void>) {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      actionInFlight.current = false
      setBusy(false)
      setProgress('')
    }
  }
  async function choose() {
    await run(async () => {
      const game = await selectCloudGame()
      let existing: CloudLibraryEntry | undefined
      for (const entry of entries) {
        if (await entry.game.picked.isSameEntry(game.picked)) {
          existing = entry
          break
        }
      }
      const id = existing?.item.id ?? crypto.randomUUID()
      const entry: CloudLibraryEntry = {
        game,
        item: {
          id,
          gameRoot: `browser:${id}`,
          name: game.picked.name,
          remark: existing?.item.remark,
          lastOpenedAt: Date.now(),
          addedAt: existing?.item.addedAt ?? Date.now(),
          missing: false,
          kindLabel: '浏览器目录',
          pathLabel: game.picked.name,
          hasShell: !!game.existingShell,
        },
      }
      await save(existing ? entries.map((e) => (e.item.id === id ? entry : e)) : [...entries, entry])
      selectId(id)
      notify.success('已加入游戏库，壳与插件可按需安装')
    })
  }
  async function operate(action: (game: CloudGame) => Promise<void>) {
    if (!active) return
    const selected = active
    await run(async () => {
      await requireCloudPermission(selected.game)
      await action(selected.game)
      const game = await inspectCloudGame(selected.game)
      await save(entries.map((e) => (e.item.id === selected.item.id ? { ...e, game, item: { ...e.item, hasShell: !!game.existingShell } } : e)))
    })
  }
  async function installShell() {
    if (active?.game.os === 'mac') {
      setMacOpen(true)
      return
    }
    await operate(async (game) => {
      const result = await installCloudShell(game, (p) => setProgress(p.message))
      setDownloadUrl(result.downloadUrl)
      notify.success(result.hint)
    })
  }
  const library = entries.map((e) => e.item)
  const status: Status = active
    ? {
        ready: true,
        canUseDisk: false,
        config: { gameRoot: active.item.gameRoot, shellSource: '' },
        library,
        contentRoot: active.game.content.name,
        projectRoot: active.game.picked.name,
        kind: active.game.content.name === 'www' ? 'www' : 'root',
        hasShell: !!active.game.existingShell,
        bundled: false,
        nestedInApp: false,
        cache: { entries: 0 },
        plugins: [],
        pluginsReady: active.game.pluginsInstalled ? 1 : 0,
        pluginsTotal: 1,
        host: { platform: active.game.os === 'mac' ? 'darwin' : active.game.os === 'win' ? 'win32' : 'linux' },
      }
    : { ready: false, canUseDisk: false, library }
  return {
    status,
    loaded,
    busy,
    active,
    choose,
    macOpen,
    setMacOpen,
    installShell,
    downloadUrl,
    progress,
    configureConnection: async () => {
      let configured = false
      await operate(async (game) => {
        await configureCloudConnection(game, active!.item.id)
        configured = true
      })
      return configured
    },
    select: (root: string) =>
      run(async () => {
        const entry = entries.find((e) => e.item.gameRoot === root)
        if (!entry) return
        await save(entries.map((e) => (e === entry ? { ...e, item: { ...e.item, lastOpenedAt: Date.now() } } : e)))
        selectId(entry.item.id)
        setDownloadUrl(undefined)
      }),
    remove: (root: string) =>
      run(async () => {
        const next = entries.filter((e) => e.item.gameRoot !== root)
        await save(next)
        if (active?.item.gameRoot === root) selectId(next[0]?.item.id ?? null)
      }),
    rename: (remark: string) =>
      run(async () => {
        await save(entries.map((e) => (e === active ? { ...e, item: { ...e.item, remark } } : e)))
      }),
    installPlugins: () =>
      operate(async (game) => {
        await installCloudPlugins(game, active?.item.id)
        notify.success('插件已安装')
      }),
    clearPlugins: () =>
      operate(async (game) => {
        await clearCloudPlugins(game)
        notify.success('插件已清除')
      }),
  }
}
