'use client'

import { useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { measureCloudFootprint } from '@/lib/browser/cloud-footprint'
import {
  CLOUD_GAME_SELECTION_EVENT,
  CLOUD_LIBRARY_CHANGED_EVENT,
  type CloudLibraryEntry,
  cloudLibraryStorage,
  readCloudGameId,
  requireCloudPermission,
  selectCloudGameId,
} from '@/lib/browser/cloud-library'
import {
  clearCloudPlugins,
  type CloudGame,
  configureCloudConnection,
  inspectCloudGame,
  installCloudPlugins,
  installCloudShell,
  selectCloudGame,
} from '@/lib/browser/cloud-prepare-game'
import { startCloudShellTask } from '@/lib/browser/cloud-shell-task'
import { writeCloudWindow } from '@/lib/browser/cloud-window'
import { forgetCloudLinkToken } from '@/lib/browser/link-token'
import { requestDownloadCenterOpen } from '@/lib/downloads/store'
import { formatBytes } from '@/lib/format-bytes'
import { libraryKindLabel } from '@/lib/game/library-label'
import { nwGameDisplayName } from '@/lib/game/nw-window'
import { countReadyPlugins } from '@/lib/game/plugins-status'
import { TRACKED_PLUGINS } from '@/lib/game/types'

import type { NwWindowConfig, Status } from './types'

const contentKind = (game: CloudGame) => (game.content.name === 'www' ? 'www' : 'content-root')

/** 游戏库条目与 server toLibraryItemView 同口径（名称 / 结构标签 / 壳 / 指纹）；目录名留在 pathLabel */
function withLibraryView({ game, item }: CloudLibraryEntry): CloudLibraryEntry {
  return {
    game,
    item: {
      ...item,
      name: nwGameDisplayName(game.nwPackage, game.picked.name),
      kindLabel: libraryKindLabel(contentKind(game)),
      pathLabel: game.picked.name,
      hasShell: !!game.existingShell,
      fingerprint: game.fingerprint ?? undefined,
    },
  }
}

export function useCloudLibrary(enabled: boolean, queryId: string | null, selectId: (id: string | null) => void) {
  const [entries, setEntries] = useState<CloudLibraryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const actionInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [macOpen, setMacOpen] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string>()
  const notify = useNotification()
  const t = useT()
  const selectIdRef = useRef(selectId)
  selectIdRef.current = selectId
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () =>
      cloudLibraryStorage()
        .then((saved) => {
          if (!cancelled) setEntries(saved.map(withLibraryView))
        })
        .catch(() => {
          if (!cancelled) notify.error(t('notify.cloudLibraryReadFailed'))
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
  }, [enabled, notify, t])

  const active = entries.find((entry) => entry.item.id === (queryId || readCloudGameId())) ?? entries[0]
  const activeId = active?.item.id ?? null
  useEffect(() => {
    if (enabled && loaded) selectCloudGameId(activeId)
  }, [enabled, loaded, activeId])
  useEffect(() => {
    if (!enabled || !queryId) return
    const sync = () => {
      const selected = readCloudGameId()
      if (selected && selected !== queryId) selectIdRef.current(selected)
    }
    window.addEventListener(CLOUD_GAME_SELECTION_EVENT, sync)
    return () => window.removeEventListener(CLOUD_GAME_SELECTION_EVENT, sync)
  }, [enabled, queryId])
  const enriching = useRef(new Set<string>())
  /** 本页已重新检测过的条目：壳 / 插件 / 指纹可能在本页外被改（本机服务、手动拷贝），每次打开页面各刷新一次 */
  const inspected = useRef(new Set<string>())
  /** 逐个检测：指纹要读每个插件文件头，游戏多时并发会集中占满磁盘读取 */
  const enrichQueue = useRef<Promise<void>>(Promise.resolve())
  /** 任务结束后再跑一轮：期间切换的当前游戏可能还缺体积 */
  const [enrichTick, setEnrichTick] = useState(0)
  /** 已授权时静默刷新游戏库条目（与 server 每次读盘同口径），当前游戏优先且只给它补体积；不弹授权 */
  useEffect(() => {
    if (!enabled) return
    const ordered = [...entries].sort((a, b) => Number(b.item.id === activeId) - Number(a.item.id === activeId))
    for (const target of ordered) {
      const id = target.item.id
      if (enriching.current.has(id)) continue
      const needsInspect = !inspected.current.has(id)
      const needsFootprint = id === activeId && !target.game.footprint
      if (!needsInspect && !needsFootprint) continue
      enriching.current.add(id)
      const patch = (fields: Partial<CloudGame>) =>
        setEntries((prev) => {
          const next = prev.map((e) => (e.item.id === id ? withLibraryView({ ...e, game: { ...e.game, ...fields } }) : e))
          void cloudLibraryStorage(next)
          return next
        })
      /** 返回是否完成了检测；未授权 / 失败不触发下一轮，避免反复排队 */
      const task = async (): Promise<boolean> => {
        const { game } = target
        const handle = game.picked as FileSystemDirectoryHandle & { queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState> }
        if (typeof handle.queryPermission !== 'function') return false
        if ((await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted') return false
        let fresh = game
        let shellChanged = false
        if (needsInspect) {
          fresh = await inspectCloudGame(game)
          inspected.current.add(id)
          shellChanged = fresh.existingShell !== game.existingShell
          patch({
            nwPackage: fresh.nwPackage,
            plugins: fresh.plugins,
            cacheEntries: fresh.cacheEntries,
            fingerprint: fresh.fingerprint,
            existingShell: fresh.existingShell,
            pluginsInstalled: fresh.pluginsInstalled,
            ...(shellChanged ? { footprint: undefined } : {}),
          })
        }
        if (id === activeId && (needsFootprint || shellChanged)) {
          patch({ footprint: await measureCloudFootprint(fresh.picked, fresh.content, fresh.existingShell) })
        }
        return true
      }
      enrichQueue.current = enrichQueue.current
        .then(task)
        .catch(() => false)
        .then((done) => {
          enriching.current.delete(id)
          if (done) setEnrichTick((n) => n + 1)
        })
    }
  }, [enabled, activeId, entries, enrichTick])
  async function save(entries: CloudLibraryEntry[]) {
    const next = entries.map(withLibraryView)
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
          kindLabel: '',
          pathLabel: game.picked.name,
          hasShell: false,
        },
      }
      await save(existing ? entries.map((e) => (e.item.id === id ? entry : e)) : [...entries, entry])
      selectId(id)
      notify.success(t('notify.cloudAddedHint'))
    })
  }
  async function operate(action: (game: CloudGame) => Promise<void>, opts?: { remeasure?: boolean }) {
    if (!active) return
    const selected = active
    await run(async () => {
      await requireCloudPermission(selected.game)
      await action(selected.game)
      const inspected = await inspectCloudGame(selected.game)
      const game = opts?.remeasure ? { ...inspected, footprint: undefined } : inspected
      await save(entries.map((e) => (e.item.id === selected.item.id ? { ...e, game } : e)))
    })
  }
  async function installShell() {
    if (active?.game.os === 'mac') {
      setMacOpen(true)
      return
    }
    if (active?.game.os === 'win') {
      const selected = active
      try {
        await requireCloudPermission(selected.game)
        const task = await startCloudShellTask(selected)
        if ('error' in task) notify.error(t('notify.shellTaskLocked'))
        else requestDownloadCenterOpen()
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) notify.error(error instanceof Error ? error.message : String(error))
      }
      return
    }
    await operate(
      async (game) => {
        const result = await installCloudShell(game)
        setDownloadUrl(result.downloadUrl)
        notify.success(result.hint)
      },
      { remeasure: true }
    )
  }
  const library = entries.map((e) => e.item)
  const footprint = active?.game.footprint
  const activePlugins = Array.isArray(active?.game.plugins) ? active.game.plugins : []
  const status: Status = active
    ? {
        ready: true,
        canUseDisk: false,
        config: { gameRoot: active.item.gameRoot, shellSource: '' },
        library,
        contentRoot: active.game.content.name,
        projectRoot: active.game.picked.name,
        kind: contentKind(active.game),
        hasShell: !!active.game.existingShell,
        bundled: false,
        nestedInApp: false,
        cache: { entries: active.game.cacheEntries ?? 0 },
        footprint: footprint && {
          contentBytes: footprint.contentBytes,
          contentLabel: formatBytes(footprint.contentBytes),
          shellBytes: footprint.shellBytes,
          shellLabel: formatBytes(footprint.shellBytes),
        },
        plugins: activePlugins,
        pluginsReady: countReadyPlugins(activePlugins),
        pluginsTotal: TRACKED_PLUGINS.length,
        nwPackage: active.game.nwPackage ?? null,
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
        for (const e of entries) if (e.item.gameRoot === root) forgetCloudLinkToken(e.item.id)
        if (active?.item.gameRoot === root) selectId(next[0]?.item.id ?? null)
      }),
    /** 须由点击触发：请求目录授权后重新检测（含 package.json） */
    reinspect: () => operate(async () => {}),
    /** 不走 run()：避免改尺寸时整卡进入 busy；失败抛给调用方提示 */
    saveWindow: async (next: NwWindowConfig) => {
      const selected = active
      if (!selected) return
      await requireCloudPermission(selected.game)
      const nwPackage = await writeCloudWindow(selected.game.content, next, selected.game.picked.name)
      await save(entries.map((e) => (e.item.id === selected.item.id ? { ...e, game: { ...e.game, nwPackage } } : e)))
    },
    rename: (remark: string) =>
      run(async () => {
        await save(entries.map((e) => (e === active ? { ...e, item: { ...e.item, remark } } : e)))
      }),
    installPlugins: () =>
      operate(async (game) => {
        await installCloudPlugins(game, active?.item.id)
        notify.success(t('notify.pluginsInstalled'))
      }),
    clearPlugins: () =>
      operate(async (game) => {
        await clearCloudPlugins(game)
        notify.success(t('notify.pluginsCleared'))
      }),
  }
}
