'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IoListOutline } from 'react-icons/io5'

import { ChooseGameGate } from '@/components/ChooseGameGate'
import { DashboardSettings } from '@/components/DashboardSettings'
import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { MacShellDialog } from '@/components/LaunchHelp'
import { LibraryPageSkeleton } from '@/components/LibraryPageSkeleton'
import { LibraryRail } from '@/components/LibraryRail'
import { useNotification } from '@/components/notification/useNotification'
import { Button, ScrollArea } from '@/components/sk'
import { readApiErrorMessage } from '@/lib/api-error'
import { onDownloadFinished, useBrowserDownloadRunning, useServerDownloadRunning } from '@/lib/downloads/store'
import type { LibraryItemView } from '@/lib/game'
import { useQueryPatch } from '@/lib/url/use-query-patch'

import { DashboardGameActions } from './dashboard/DashboardGameActions'
import { DashboardGameCard } from './dashboard/DashboardGameCard'
import { libraryIdForRoot, rootsEqual, type Status } from './dashboard/types'
import { useCloudLibrary } from './dashboard/useCloudLibrary'
import { useDashboardActions } from './dashboard/useDashboardActions'
import { useDashboardLaunch } from './dashboard/useDashboardLaunch'
import { useWindowSettings } from './dashboard/useWindowSettings'

/** 浏览器装壳进入读写队列后才会动游戏目录；等待选文件时仍可连接 */
const SHELL_WRITE_PHASES = ['queued', 'read', 'write'] as const

export function Dashboard() {
  const t = useT()
  const [serverStatus, setStatus] = useState<Status | null>(null)
  const [gameRoot, setGameRoot] = useState('')
  const [shellSource, setShellSource] = useState('')
  const [localBusy, setBusy] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const applyingGameQuery = useRef(false)
  /** 用户点选 / 深链要落到的库 id；达成前忽略轮询旧状态，并钉住 URL */
  const targetGameId = useRef<string | null>(null)
  /** 递增；过期的 bindGame 响应一律丢弃，避免连点/竞态把选中打回旧游戏 */
  const bindSeq = useRef(0)
  const bindAbort = useRef<AbortController | null>(null)
  /** 正在 PUT 的游戏根；防止 status 刷新在 busy 置位前重复触发绑定 */
  const bindingRootRef = useRef<string | null>(null)
  const notify = useNotification()
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const { searchParams, replaceQuery } = useQueryPatch()

  const browserMode = serverStatus?.canUseDisk === false
  const cloud = useCloudLibrary(browserMode, searchParams.get('game'), (id) => replaceQuery({ game: id }))
  const status = browserMode ? cloud.status : serverStatus
  const busy = localBusy || (browserMode && cloud.busy)
  const { win, setWin, winSaveTimer, patchWin, patchWinSize } = useWindowSettings(
    browserMode ? cloud.active?.item.gameRoot || '' : status?.config?.gameRoot || '',
    browserMode ? (next) => cloud.saveWindow(next) : undefined
  )
  const cloudWindow = browserMode ? cloud.active?.game.nwPackage?.window : undefined
  const cloudGameId = cloud.active?.item.id
  useEffect(() => {
    if (!browserMode || winSaveTimer.current) return
    setWin(cloudWindow ? { ...cloudWindow } : null)
  }, [browserMode, cloudGameId, cloudWindow, setWin, winSaveTimer])
  const gameLink = useGameLinkContext()

  const refresh = useCallback(async (): Promise<Status | null> => {
    const res = await fetch('/api/status')
    const data = (await res.json()) as Status & { bindEpoch?: number }
    if (typeof data.bindEpoch === 'number' && data.bindEpoch > bindSeq.current) {
      bindSeq.current = data.bindEpoch
    }
    setStatus(data)
    if (data.config?.gameRoot) setGameRoot(data.config.gameRoot)
    else setGameRoot('')
    if (data.config?.shellSource) setShellSource(data.config.shellSource)
    if (data.canUseDisk !== false) setWin(data.ready && data.nwPackage?.window ? { ...data.nwPackage.window } : null)
    if (data.heal?.message) notifyRef.current.info(data.heal.message)
    return data
  }, [setWin])

  /** 轮询状态；切换游戏进行中丢弃响应，避免旧 GET 盖住刚 PUT 的选中 */
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      const data = (await res.json()) as Status & { bindEpoch?: number }
      if (typeof data.bindEpoch === 'number' && data.bindEpoch > bindSeq.current) {
        bindSeq.current = data.bindEpoch
      }
      if (applyingGameQuery.current || targetGameId.current) return
      setStatus(data)
      if (!winSaveTimer.current && data.canUseDisk !== false) {
        if (data.ready && data.nwPackage?.window) setWin({ ...data.nwPackage.window })
        else if (!data.ready) setWin(null)
      }
    } catch {
      /* ignore poll errors */
    }
  }, [setWin, winSaveTimer])

  const { launchPending, launchGame, quitGame } = useDashboardLaunch({ status, busy, setBusy, pollStatus, queryGameId: searchParams.get('game') })

  useEffect(() => {
    void refresh()
  }, [refresh])

  const serverShellJob = useServerDownloadRunning('nw-shell')
  const browserShellJob = useBrowserDownloadRunning('nw-shell', cloudGameId)
  const browserShellWriting = useBrowserDownloadRunning('nw-shell', cloudGameId, SHELL_WRITE_PHASES)
  const shellJobRunning = browserMode ? browserShellJob : serverShellJob
  useEffect(
    () =>
      onDownloadFinished((item) => {
        if (!browserMode && item.channel === 'server' && item.kind === 'nw-shell' && (item.status === 'done' || item.status === 'error')) void refresh()
      }),
    [browserMode, refresh]
  )

  useEffect(() => {
    const online = gameLink.connected
    // 在线 / 等待连接：8s；空闲：20s。页签隐藏时停轮询。
    const intervalMs = online || launchPending ? 8_000 : 20_000
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const start = () => {
      stop()
      if (typeof document !== 'undefined' && document.hidden) return
      timer = setInterval(() => {
        void pollStatus()
      }, intervalMs)
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
        return
      }
      void pollStatus()
      start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollStatus, launchPending, gameLink.connected])

  async function pick(kind: 'folder' | 'app' | 'game') {
    setBusy(true)
    notify.info(t('notify.pickOpening'))
    try {
      const res = await fetch('/api/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
      }
      if (data.cancelled || !data.ok || !data.path) {
        notify[data.cancelled ? 'info' : 'error'](data.cancelled ? t('notify.cancelled') : readApiErrorMessage(data, t('notify.pickFailed')))
        return null
      }
      return data.path
    } catch {
      notify.error(t('notify.pickerUnavailable'))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function chooseGame() {
    if (browserMode) {
      await cloud.choose()
      return
    }
    const path = await pick('game')
    if (!path) return
    await bindGame(path, { announce: t('notify.addedToLibrary') })
  }

  function clearGameTargetLock() {
    targetGameId.current = null
    applyingGameQuery.current = false
  }

  function lockGameTarget(id: string) {
    targetGameId.current = id
    applyingGameQuery.current = true
  }

  /**
   * 绑定游戏根目录。库内切换不弹 toast；选目录才 announce。
   * 侧栏点选只改 URL，由下方 effect 静默调用。
   */
  async function bindGame(path: string, opts?: { announce?: string | false; staleRetry?: boolean }) {
    const next = path.trim().replace(/^['"]+|['"]+$/g, '')
    if (!next) {
      notify.warning(t('notify.needGamePath'))
      return
    }
    const seq = ++bindSeq.current
    bindAbort.current?.abort()
    const ac = new AbortController()
    bindAbort.current = ac
    bindingRootRef.current = next
    setBusy(true)
    applyingGameQuery.current = true
    const stillCurrent = () => bindAbort.current === ac
    try {
      const res = await fetch('/api/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameRoot: next,
          shellSource: shellSource || undefined,
          bindEpoch: seq,
        }),
        signal: ac.signal,
      })
      if (!stillCurrent()) return
      const data = await res.json()
      // HMR / 多标签会让客户端 seq 落后于服务端；跟齐后再由 effect 重试
      if (typeof data.bindEpoch === 'number' && data.bindEpoch > bindSeq.current) {
        bindSeq.current = data.bindEpoch
      }
      // 无论成功 / unchanged / 过期，都拉权威状态，避免本地停在旧作 → PUT 风暴
      const fresh = await refresh()
      if (!stillCurrent()) return

      if (data.ignoredStaleBind) {
        // 过期响应的 config 是旧选中：绝不能用来改 URL / lock
        const urlId = searchParams.get('game')
        const root = fresh?.config?.gameRoot || ''
        const selectedId = root ? libraryIdForRoot(fresh?.library || [], root) : null
        if (urlId && selectedId === urlId) {
          clearGameTargetLock()
          return
        }
        // 跟齐 epoch 后立刻再绑一次（避免重载后 effect 未再触发）
        if (!opts?.staleRetry && stillCurrent()) {
          bindingRootRef.current = null
          setBusy(false)
          await bindGame(next, { announce: false, staleRetry: true })
        }
        return
      }
      if (!res.ok) {
        notify.error(readApiErrorMessage(data, t('notify.bindFailed')))
        setGameRoot(next)
        clearGameTargetLock()
        return
      }

      const boundRoot = String(fresh?.config?.gameRoot || (data.config as { gameRoot?: string } | undefined)?.gameRoot || next)
      setGameRoot(boundRoot)
      const lib = (fresh?.library || (Array.isArray(data.library) ? data.library : status?.library) || []) as LibraryItemView[]
      const id = libraryIdForRoot(lib, boundRoot)
      if (id) {
        lockGameTarget(id)
        if (searchParams.get('game') !== id) replaceQuery({ game: id })
      }
      if (opts?.announce) notify.success(opts.announce)
      if (id && targetGameId.current === id && (searchParams.get('game') === id || !searchParams.get('game'))) {
        clearGameTargetLock()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (stillCurrent()) notify.error(t('notify.bindFailed'))
    } finally {
      if (bindingRootRef.current && rootsEqual(bindingRootRef.current, next)) {
        bindingRootRef.current = null
      }
      if (stillCurrent()) setBusy(false)
    }
  }

  const bindGameRef = useRef(bindGame)
  bindGameRef.current = bindGame

  /** URL 与目标 lock 对齐；切换进行中勿把 lock 扳回尚未 replace 的旧 query */
  useEffect(() => {
    const target = targetGameId.current
    if (browserMode || !target || !status) return
    const current = searchParams.get('game')
    if (current && current !== target) {
      const entry = (status.library || []).find((item) => item.id === current)
      // 无进行中切换时才跟用户新 URL；正在 apply 时旧 query 仍可能短暂残留
      if (entry && !entry.missing && !applyingGameQuery.current) {
        lockGameTarget(current)
        return
      }
      replaceQuery({ game: target })
      return
    }
    const root = status.ready ? status.config.gameRoot : ''
    if (root && libraryIdForRoot(status.library || [], root) === target) {
      clearGameTargetLock()
    }
  }, [browserMode, status, searchParams, replaceQuery])

  /**
   * 补全 / 校正 URL `?game=`（无目标锁定时）：
   * - 无 query → 写成当前选中
   * - query 无效 → 改成当前选中或清掉
   * - query 有效 → 绝不覆盖
   */
  useEffect(() => {
    if (browserMode || !status || applyingGameQuery.current || targetGameId.current) return
    const root = status.ready ? status.config.gameRoot : ''
    const nextId = root ? libraryIdForRoot(status.library || [], root) : null
    const current = searchParams.get('game')
    if (current) {
      const entry = (status.library || []).find((item) => item.id === current)
      if (entry && !entry.missing) return
      if (nextId) replaceQuery({ game: nextId })
      else replaceQuery({ game: null })
      return
    }
    if (nextId) replaceQuery({ game: nextId })
  }, [browserMode, status, searchParams, replaceQuery])

  /** URL `?game=` → 静默选中（不弹「已打开游戏」） */
  const configGameRoot = status && status.ready ? status.config.gameRoot : ''
  const urlGameId = searchParams.get('game')
  useEffect(() => {
    if (browserMode || !status || busy) return
    if (!urlGameId) return
    const target = targetGameId.current
    // 仅当锁定的是「别的作」时才跳过；锁定当前 URL 时仍要 PUT 绑定
    if (applyingGameQuery.current && target && target !== urlGameId) return
    if (target && target !== urlGameId) return
    const entry = (status.library || []).find((item) => item.id === urlGameId)
    if (!entry || entry.missing) return
    // 用库 id 判断是否已选中（比纯路径稳，避免 lastOpenedAt 刷新后重复 PUT）
    const currentId = configGameRoot ? libraryIdForRoot(status.library || [], configGameRoot) : null
    if (currentId === urlGameId) {
      if (target === urlGameId) clearGameTargetLock()
      return
    }
    if (entry.remote) {
      const currentEntry = currentId ? (status.library || []).find((item) => item.id === currentId) : null
      if (currentEntry && !currentEntry.remote) return
    }
    if (bindingRootRef.current && rootsEqual(bindingRootRef.current, entry.gameRoot)) return
    void bindGameRef.current(entry.gameRoot, { announce: false })
  }, [browserMode, status, configGameRoot, urlGameId, busy])

  /** 侧栏点选：钉住目标 id + 只改 URL，绑定交给上面的 effect */
  function selectLibraryRoot(root: string) {
    if (browserMode) {
      void cloud.select(root)
      return
    }
    const entry = (status?.library || []).find((item) => rootsEqual(item.gameRoot, root))
    if (!entry || entry.missing) return
    if (searchParams.get('game') === entry.id) {
      const current = status?.ready ? status.config.gameRoot : ''
      if (current && libraryIdForRoot(status?.library || [], current) === entry.id) return
    }
    bindAbort.current?.abort()
    bindSeq.current += 1
    bindingRootRef.current = null
    setBusy(false)
    lockGameTarget(entry.id)
    if (searchParams.get('game') !== entry.id) replaceQuery({ game: entry.id })
    else void bindGameRef.current(entry.gameRoot, { announce: false })
  }

  const { chooseShell, bindShell, copyPath, saveGameRemark, removeGame, installShell, fetchLatestShell, uninstallShell, injectPlugins, clearPlugins } = useDashboardActions({
    status,
    shellSource,
    setShellSource,
    setBusy,
    refresh,
    pick,
  })

  const ready = !!(status && status.ready)
  const remote = !!(ready && status.remote)
  const diskOk = status?.canUseDisk !== false
  const loading = serverStatus === null || (browserMode && !cloud.loaded)
  const library = status?.library || []
  const emptyLibrary = !loading && !ready && library.length === 0
  const gameTitle = !ready
    ? ''
    : status.nwPackage?.window?.title?.trim() ||
      status.nwPackage?.name?.trim() ||
      (browserMode && cloud.active ? cloud.active.item.name : status.config.gameRoot.split(/[/\\]/).filter(Boolean).pop()) ||
      (remote ? '远程游戏' : '游戏')
  const libraryEntry = ready ? (status.library || []).find((item) => rootsEqual(item.gameRoot, status.config.gameRoot)) : undefined
  const gameRemark = libraryEntry?.remark?.trim() || ''
  const gamePackageName = ready && status.nwPackage?.name?.trim() ? status.nwPackage.name.trim() : null
  const layoutLabel = ready
    ? remote
      ? t('dashboard.kindRemote')
      : status.bundled
        ? status.host?.platform === 'win32'
          ? t('dashboard.kindExe')
          : t('dashboard.kindApp')
        : status.kind === 'www'
          ? t('dashboard.kindWww')
          : status.kind === 'app.nw'
            ? 'app.nw'
            : t('dashboard.kindRoot')
    : ''
  const canInstall = browserMode ? ready && !status.hasShell : diskOk && ready && !remote && !status.bundled && !status.hasShell
  /** 仅 Chaya 注入的共用壳可卸；游戏自带 .app / exe 不展示（浏览器只检测 Chaya 壳目录名） */
  const canUninstallShell = browserMode ? ready && status.hasShell : diskOk && ready && !remote && !status.bundled && !!status.installedShell
  const gameOnline = gameLink.connected
  /** 本机未打包：可从 nwjs.io 拉最新壳（含 Windows，效果同自备 nwjs.app） */
  const canFetchLatestShell = diskOk && ready && !remote && !status.bundled && !gameOnline
  const canLaunch = browserMode ? ready && !gameOnline : diskOk && ready && !remote && status.hasShell && !gameOnline && !launchPending
  // 空闲时后台也会协商 offer，勿把 negotiating 当成「正在等人点启动」
  const launchLabel = gameOnline ? t('dashboard.launchPause') : launchPending ? t('dashboard.launchWait') : browserMode ? t('dashboard.launchConnect') : t('dashboard.launchStart')
  const launchTooltip = !diskOk
    ? t('dashboard.tipConnect')
    : remote
      ? t('dashboard.tipRemoteNoLaunch')
      : gameOnline
        ? t('dashboard.tipQuit')
        : launchPending
          ? t('dashboard.tipWaiting')
          : undefined
  const pluginsNeedInject = (diskOk || browserMode) && ready && !remote && typeof status.pluginsTotal === 'number' && (status.pluginsReady ?? 0) < status.pluginsTotal
  const pluginsInjected =
    (diskOk || browserMode) && ready && !remote && typeof status.pluginsTotal === 'number' && status.pluginsTotal > 0 && (status.pluginsReady ?? 0) >= status.pluginsTotal

  return (
    <>
      <MacShellDialog open={cloud.macOpen} onClose={() => cloud.setMacOpen(false)} gameName={cloud.active?.game.picked.name} />
      {loading ? (
        <LibraryPageSkeleton />
      ) : emptyLibrary ? (
        <ChooseGameGate busy={busy} canUseDisk={diskOk} onChoose={() => void chooseGame()} />
      ) : (
        <div className="flex min-h-0 flex-1 items-stretch gap-0">
          <LibraryRail
            entries={library}
            activeRoot={ready ? status.config.gameRoot : ''}
            busy={busy}
            canUseDisk={diskOk || browserMode}
            mobileOpen={libraryOpen}
            onMobileOpenChange={setLibraryOpen}
            onSelect={(root) => {
              selectLibraryRoot(root)
            }}
            onAdd={() => void chooseGame()}
            onRemove={(root) => (browserMode ? cloud.remove(root) : removeGame(root))}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
            <div className="mb-3 flex shrink-0 items-center md:hidden">
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={t('library.title')}
                tooltip={t('library.title')}
                aria-expanded={libraryOpen}
                onClick={() => setLibraryOpen(true)}
              >
                <IoListOutline size={18} aria-hidden />
              </Button>
            </div>
            {!ready ? (
              <ChooseGameGate className="min-h-0" busy={busy} canUseDisk={diskOk} onChoose={() => void chooseGame()} />
            ) : (
              <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('dashboard.currentGame') }}>
                <div className="flex w-full max-w-[48rem] flex-col gap-4">
                  <DashboardGameCard
                    title={gameTitle}
                    remark={gameRemark}
                    packageName={gamePackageName}
                    busy={busy}
                    onRename={(next) => void (browserMode ? cloud.rename(next) : saveGameRemark(next))}
                    binding={
                      remote
                        ? undefined
                        : {
                            kind: status.kind,
                            hasShell: status.hasShell,
                            bundled: status.bundled,
                            plugins: status.plugins,
                            hasNwPackage: !!status.nwPackage,
                            platform: status.host?.platform,
                            shellPath: browserMode && cloud.active ? `${cloud.active.game.picked.name}/${cloud.active.game.existingShell ?? ''}` : undefined,
                          }
                    }
                    meta={{ status, remote, layoutLabel, win, online: gameOnline, pending: launchPending }}
                    actions={
                      remote ? (
                        <p className="m-0 text-[0.75rem] leading-relaxed text-ink-soft">{t('dashboard.remoteSessionHint')}</p>
                      ) : (
                        <DashboardGameActions
                          busy={busy}
                          launch={{
                            online: gameOnline,
                            pending: launchPending,
                            enabled: canLaunch && !(browserMode && browserShellWriting),
                            label: launchLabel,
                            tooltip: launchTooltip,
                            onStart: browserMode
                              ? async () => {
                                  if (!(await cloud.configureConnection())) return
                                  if (cloud.active) {
                                    gameLink.armRoom(cloud.active.item.id)
                                    await gameLink.restart(cloud.active.item.id)
                                  }
                                }
                              : launchGame,
                            onQuit: quitGame,
                          }}
                          plugins={{
                            state: pluginsNeedInject ? 'missing' : pluginsInjected ? 'ready' : 'unavailable',
                            onInstall: browserMode ? cloud.installPlugins : injectPlugins,
                            onClear: browserMode ? cloud.clearPlugins : clearPlugins,
                          }}
                          shell={{
                            canInstall,
                            canUninstall: canUninstallShell,
                            canFetch: canFetchLatestShell,
                            hasShell: status.hasShell,
                            hasSource: browserMode || (!!shellSource.trim() && status.config.shellSourceValid !== false),
                            jobRunning: shellJobRunning,
                            onInstall: browserMode ? cloud.installShell : installShell,
                            onFetchLatest: fetchLatestShell,
                            onUninstall: browserMode ? cloud.uninstallShell : uninstallShell,
                          }}
                          shellTaskGameId={browserMode ? cloudGameId : undefined}
                        />
                      )
                    }
                    notes={
                      browserMode && cloud.downloadUrl ? (
                        <a className="text-accent underline" href={cloud.downloadUrl}>
                          {t('dashboard.downloadLinuxShell')}
                        </a>
                      ) : null
                    }
                  />

                  <DashboardSettings
                    busy={busy}
                    bundled={status.bundled}
                    remote={remote}
                    browserMode={browserMode}
                    windowNeedsAuth={browserMode && cloud.active?.game.nwPackage === undefined}
                    onAuthorizeWindow={() => void cloud.reinspect()}
                    browserFolder={cloud.active?.game.picked.name}
                    platform={status.host?.platform}
                    gameRoot={gameRoot}
                    shellSource={shellSource}
                    win={win}
                    boundGameRoot={status.config.gameRoot}
                    boundShellSource={status.config.shellSource}
                    onGameRootChange={setGameRoot}
                    onShellSourceChange={setShellSource}
                    onBindGame={(path) => void bindGame(path, { announce: t('notify.switchedPath') })}
                    onBindShell={(path) => void bindShell(path)}
                    onChooseGame={() => void chooseGame()}
                    onChooseShell={() => void chooseShell()}
                    onCopyPath={(text) => void copyPath(text)}
                    onPatchWin={patchWin}
                    onPatchWinSize={patchWinSize}
                  />
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </>
  )
}
