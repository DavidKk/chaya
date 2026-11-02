'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'

import { GameSelectorModal } from './GameSelectorModal'
import { haptic } from './haptic'
import { IosInstallGuideModal } from './IosInstallGuideModal'
import { RemotePlayConfirmations } from './RemotePlayConfirmations'
import { RemotePlayLauncher } from './RemotePlayLauncher'
import { RemotePlaySettings } from './RemotePlaySettings'
import { RemotePlaySurface } from './RemotePlaySurface'
import { useRemoteCover } from './useRemoteCover'
import { useRemoteDesktopInput } from './useRemoteDesktopInput'
import { useRemoteEnvironment } from './useRemoteEnvironment'
import { useRemoteSession } from './useRemoteSession'
import type { ControlMode } from './VirtualController'
import { RemoteWorkspaceModal, type RemoteWorkspaceTab } from './workspace'

type RemotePlayViewProps = {
  initialRoomId?: string
}

type StatusToast = {
  type: 'connected' | 'disconnected' | 'connecting' | 'info'
  text: string
  exiting?: boolean
}

export function RemotePlayView({ initialRoomId }: RemotePlayViewProps) {
  const t = useT()
  const session = useRemoteSession(initialRoomId)
  const { roomId, status, isSpectator, latencyMs, linkRef, videoRef, streamRef, quit, claimControl } = session
  const { isIdle, isPortrait, isStandalone, isFullscreen, resetIdleTimer } = useRemoteEnvironment(status === 'connected', session.resume)
  const { coverImage, captureCover, onPlaying } = useRemoteCover(session.selectedGame?.id || initialRoomId, videoRef)
  const [muted, setMuted] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<RemoteWorkspaceTab>('cheats')
  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(null)
  const [hudVisible, setHudVisible] = useState(false)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain')

  // Unified Menu Modal (Single Button trigger)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuTab, setMenuTab] = useState<'gamepad' | 'quick' | 'display' | 'system'>('gamepad')

  // Control Mode: fixed, dynamic, single-left, single-right, touch (persisted in localStorage)
  const [controlMode, setControlMode] = useState<ControlMode>('fixed')
  const [hapticEnabled, setHapticEnabled] = useState(true)
  const [controllerOpacity, setControllerOpacity] = useState(0.65)

  const handleSelectOpacity = useCallback((val: number) => {
    setControllerOpacity(val)
    try {
      localStorage.setItem('chaya_remote_pad_opacity', String(val))
    } catch {
      /* ignore */
    }
    remotePlayLogger.info(`Controller opacity set to: ${val}`)
  }, [])

  const [clientMode, setClientMode] = useState<'auto' | 'desktop' | 'mobile'>('auto')

  // Read preferences after hydration so saved values cannot mismatch the server markup.
  useEffect(() => {
    setHapticEnabled(haptic.isEnabled())
    try {
      setHudVisible(localStorage.getItem('chaya_remote_play_hud') === '1')
      const fit = localStorage.getItem('chaya_remote_play_fit')
      if (fit === 'contain' || fit === 'cover') setFitMode(fit)
      const mode = localStorage.getItem('chaya_remote_control_mode') as ControlMode
      if (['fixed', 'dynamic', 'single-left', 'single-right', 'touch'].includes(mode)) setControlMode(mode)
      const client = localStorage.getItem('chaya_remote_client_mode')
      if (client === 'auto' || client === 'desktop' || client === 'mobile') setClientMode(client)
      const opacity = Number(localStorage.getItem('chaya_remote_pad_opacity'))
      if (opacity >= 0.2 && opacity <= 1) setControllerOpacity(opacity)
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
  }, [])

  const handleSelectClientMode = useCallback((mode: 'auto' | 'desktop' | 'mobile') => {
    setClientMode(mode)
    try {
      localStorage.setItem('chaya_remote_client_mode', mode)
    } catch {
      /* ignore */
    }
    remotePlayLogger.info(`Client layout mode set to: ${mode}`)
  }, [])
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false)

  // Auto-reconnect & toast states
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null)

  const [gameSelectorOpen, setGameSelectorOpen] = useState(false)

  const refreshGames = session.refreshGames
  const openGameSelector = useCallback(() => {
    setGameSelectorOpen(true)
    void refreshGames()
  }, [refreshGames])

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef(status)

  const showStatusToast = useCallback((type: 'connected' | 'disconnected' | 'connecting' | 'info', text: string, durationMs = 2800) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current)
    setStatusToast({ type, text, exiting: false })
    const exitDelay = Math.max(800, durationMs - 300)
    toastExitTimerRef.current = setTimeout(() => {
      setStatusToast((prev) => (prev ? { ...prev, exiting: true } : null))
      toastTimeoutRef.current = setTimeout(() => {
        setStatusToast(null)
      }, 300)
    }, exitDelay)
  }, [])

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current)
    },
    []
  )

  const handleInput = useCallback(
    (key: RemoteInputKey, action: 'down' | 'up') => {
      linkRef.current?.send({
        type: 'remote.input',
        key,
        action,
      })
    },
    [linkRef]
  )

  const [autoTalk, setAutoTalk] = useState(false)

  const handleAction = useCallback(
    (id: string) => {
      if (!linkRef.current?.connected) return
      if (id === 'flag:autotalk' || id === 'autotalk') {
        setAutoTalk((prev) => {
          const next = !prev
          remotePlayLogger.info(`Toggled autotalk shortcut: ${next}`)
          linkRef.current?.send({
            type: 'edit.cmd',
            cmdId: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            op: 'runFlag',
            key: 'autotalk',
            value: next,
          } as any)
          showStatusToast('info', t(next ? 'play.autoTalkEnabled' : 'play.autoTalkDisabled'), 1800)
          return next
        })
        return
      }

      remotePlayLogger.info(`Triggering remote game action shortcut: ${id}`)
      linkRef.current.send({
        type: 'edit.cmd',
        cmdId: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        op: 'runAction',
        id: id as any,
      })
    },
    [linkRef, showStatusToast, t]
  )

  const handleOpenDrawer = useCallback(() => {
    setDrawerTab('cheats')
    setDrawerOpen(true)
  }, [])

  const isDesktop = clientMode === 'desktop' || (clientMode === 'auto' && typeof window !== 'undefined' && !remotePlayLogger.getDiagnostics().isMobile)

  const executeHardReload = useCallback(() => {
    remotePlayLogger.info('User confirmed clear cache and hard reload')
    setReloadConfirmOpen(false)
    try {
      localStorage.removeItem('chaya_remote_control_mode')
      localStorage.removeItem('chaya_remote_client_mode')
      localStorage.removeItem('chaya_remote_fit_mode')
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    window.location.href = window.location.pathname + '?_t=' + Date.now()
  }, [])

  const handleQuitOrLeave = useCallback(() => {
    if (isSpectator) {
      setMenuOpen(false)
      session.cancel()
      showStatusToast('info', t('play.exitSpectator'), 2000)
      return
    }
    setQuitConfirmOpen(true)
  }, [isSpectator, session, showStatusToast, t])

  const executeQuitGame = useCallback(async () => {
    captureCover()
    setQuitConfirmOpen(false)
    setMenuOpen(false)
    setDrawerOpen(false)
    if (await quit()) showStatusToast('info', t('play.gameExited'), 3000)
  }, [quit, showStatusToast, t, captureCover])

  // 1. Toast notifications on connection status changes
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      const prev = prevStatusRef.current
      prevStatusRef.current = status

      if (status === 'connected') {
        showStatusToast('connected', t('play.connected'))
      } else if (status === 'disconnected') {
        if (session.phase === 'failed') {
          showStatusToast('disconnected', t('play.connectionFailed'), 3000)
        }
      } else if (status === 'connecting' && prev === 'disconnected') {
        showStatusToast('connecting', t('play.connecting'), 2000)
      }
    }
  }, [status, session.phase, showStatusToast, t])

  useEffect(() => {
    if (session.notice) {
      const key = session.notice === 'switchFailed' ? 'play.switchFailed' : session.notice === 'quitFailed' ? 'play.quitFailed' : 'play.launchFailedDesc'
      showStatusToast('disconnected', t(key), 3000)
    }
  }, [session.notice, showStatusToast, t])

  const handleGlobalPointerDown = () => {
    if (videoRef.current && videoRef.current.paused && videoRef.current.srcObject) {
      remotePlayLogger.info('User tapped screen to resume video playback')
      void videoRef.current.play().catch(() => {})
    }
  }

  // 7. Unmute audio on user tap
  const handleUnmute = () => {
    setMuted(false)
    remotePlayLogger.info('User unmuted stream audio')
    if (videoRef.current) {
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }

  const toggleFullscreen = () => {
    resetIdleTimer()

    if (isStandalone) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('Detected standalone PWA full-screen mode')
      return
    }

    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {})
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen().catch(() => {})
      }
      remotePlayLogger.info('User exited full-screen mode')
      return
    }

    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>
    }
    const isIos = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

    if (isIos || (!docEl.requestFullscreen && !docEl.webkitRequestFullscreen)) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('Triggered iOS Safari Add to Home Screen guide')
      return
    }

    if (docEl.requestFullscreen) {
      docEl
        .requestFullscreen()
        .then(() => {
          remotePlayLogger.ok('Successfully entered browser fullscreen')
        })
        .catch(() => {
          setInstallGuideOpen(true)
        })
    } else if (docEl.webkitRequestFullscreen) {
      try {
        void docEl.webkitRequestFullscreen()
      } catch {
        setInstallGuideOpen(true)
      }
    } else {
      setInstallGuideOpen(true)
    }
  }

  useRemoteDesktopInput({
    enabled: status === 'connected' && isDesktop && !isSpectator && !menuOpen && !drawerOpen && !quitConfirmOpen && !reloadConfirmOpen && !gameSelectorOpen,
    onInput: handleInput,
    onFullscreen: toggleFullscreen,
  })

  const toggleFitMode = () => {
    resetIdleTimer()
    setFitMode((prev) => {
      const next = prev === 'contain' ? 'cover' : 'contain'
      try {
        localStorage.setItem('chaya_remote_play_fit', next)
      } catch {
        /* ignore */
      }
      remotePlayLogger.info(`Switched aspect ratio mode to: ${next}`)
      return next
    })
  }

  const handleToggleHud = () => {
    resetIdleTimer()
    setHudVisible((prev) => {
      const next = !prev
      try {
        localStorage.setItem('chaya_remote_play_hud', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const handleSelectControlMode = (mode: ControlMode) => {
    setControlMode(mode)
    try {
      localStorage.setItem('chaya_remote_control_mode', mode)
    } catch {
      /* ignore */
    }
    const modeLabel =
      mode === 'fixed'
        ? t('play.modeFixed')
        : mode === 'dynamic'
          ? t('play.modeDynamic')
          : mode === 'single-left'
            ? t('play.modeSingleLeft')
            : mode === 'single-right'
              ? t('play.modeSingleRight')
              : t('play.modeTouch')
    showStatusToast('connecting', modeLabel, 2000)
    remotePlayLogger.info(`Control mode switched to: ${mode}`)
  }

  const effectiveIdle = isIdle && status === 'connected' && !drawerOpen && !menuOpen

  return (
    <main onPointerDown={handleGlobalPointerDown} className="relative h-dvh w-screen overflow-hidden bg-black select-none touch-none">
      <style>{`
        @keyframes connecting-breathe {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* 1. Status Change Toast */}
      {statusToast && (
        <div style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }} className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4">
          <div
            role="status"
            className={`flex items-center gap-2 rounded-full border border-line bg-panel/95 px-3 py-2 shadow-xl backdrop-blur-md select-none animate-in fade-in duration-200 transition-opacity duration-300 ${statusToast.exiting ? 'opacity-0' : 'opacity-100'}`}
          >
            {statusToast.type === 'connected' ? (
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            ) : statusToast.type === 'disconnected' ? (
              <span className="flex h-2 w-2 rounded-full bg-rose-500 shrink-0" />
            ) : (
              <span className="flex h-2 w-2 rounded-full bg-amber-400 shrink-0" />
            )}
            <span className="text-xs font-semibold text-neutral-100 whitespace-nowrap shrink-0">{statusToast.text}</span>
            {statusToast.type === 'connected' && latencyMs != null && <span className="text-[10px] font-mono text-emerald-400 whitespace-nowrap shrink-0">{latencyMs}ms</span>}
          </div>
        </div>
      )}

      <RemotePlaySurface
        videoRef={videoRef}
        streamRef={streamRef}
        linkRef={linkRef}
        coverImage={coverImage}
        connected={status === 'connected'}
        isSpectator={isSpectator}
        isPortrait={isPortrait}
        isDesktop={isDesktop}
        muted={muted}
        fitMode={fitMode}
        isFullscreen={isFullscreen}
        isStandalone={isStandalone}
        idle={effectiveIdle}
        hudVisible={hudVisible}
        latencyMs={latencyMs}
        videoFps={session.videoFps}
        videoResolution={videoResolution}
        controlMode={controlMode}
        controllerOpacity={controllerOpacity}
        autoTalk={autoTalk}
        onInput={handleInput}
        onAction={handleAction}
        onDrawer={handleOpenDrawer}
        onMenu={() => setMenuOpen(true)}
        onQuit={handleQuitOrLeave}
        onMute={muted ? handleUnmute : () => setMuted(true)}
        onFit={toggleFitMode}
        onFullscreen={toggleFullscreen}
        onHideHud={() => setHudVisible(false)}
        onResolution={setVideoResolution}
        onPlaying={onPlaying}
      />
      <RemotePlaySettings
        open={menuOpen}
        tab={menuTab}
        isSpectator={isSpectator}
        onClaimControl={claimControl}
        onTab={setMenuTab}
        onClose={() => setMenuOpen(false)}
        isPortrait={isPortrait}
        controlMode={controlMode}
        onControlMode={handleSelectControlMode}
        hapticEnabled={hapticEnabled}
        onHaptic={() => setHapticEnabled(haptic.toggle())}
        controllerOpacity={controllerOpacity}
        onOpacity={handleSelectOpacity}
        onDrawer={(tab) => {
          setDrawerTab(tab === 'cheat' ? 'cheats' : tab)
          setDrawerOpen(true)
          setMenuOpen(false)
        }}
        muted={muted}
        onMute={muted ? handleUnmute : () => setMuted(true)}
        fitMode={fitMode}
        onFit={toggleFitMode}
        hudVisible={hudVisible}
        onHud={handleToggleHud}
        isStandalone={isStandalone}
        isFullscreen={isFullscreen}
        onFullscreen={() => {
          toggleFullscreen()
          setMenuOpen(false)
        }}
        isDesktop={isDesktop}
        onClientMode={handleSelectClientMode}
        hasGames={session.library.length > 0}
        selectedName={session.selectedGame?.name}
        onSelectGame={() => {
          session.cancel()
          openGameSelector()
          setMenuOpen(false)
        }}
        onReload={() => {
          setMenuOpen(false)
          setReloadConfirmOpen(true)
        }}
        onQuit={() => {
          setMenuOpen(false)
          handleQuitOrLeave()
        }}
      />
      <RemotePlayLauncher
        phase={session.phase}
        failureKind={session.failureKind}
        retryCount={session.retryCount}
        coverImage={coverImage}
        selectedGame={session.selectedGame}
        ready={session.ready}
        selecting={session.selecting}
        onSettings={() => {
          setMenuTab('system')
          setMenuOpen(true)
        }}
        onSelect={openGameSelector}
        onLaunch={() => void session.launch()}
        onCancel={session.cancel}
        onRetry={session.reconnect}
        onLogs={() => {
          setDrawerTab('logs')
          setDrawerOpen(true)
        }}
      />

      {/* 5. iOS Safari Add to Home Screen Fullscreen Guide Modal */}
      <IosInstallGuideModal open={installGuideOpen} onClose={() => setInstallGuideOpen(false)} isStandalone={isStandalone} />

      {/* 6. Full-screen Remote Modding & Diagnostics Workspace Modal */}
      <RemoteWorkspaceModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSend={(msg) => linkRef.current?.send(msg)}
        gameId={roomId}
        initialTab={drawerTab}
        status={status}
        latencyMs={latencyMs}
        videoResolution={videoResolution}
        hudVisible={hudVisible}
        onToggleHud={handleToggleHud}
        isPortrait={isPortrait}
        autoTalk={autoTalk}
        onToggleAutoTalk={() => handleAction('flag:autotalk')}
      />

      <GameSelectorModal
        open={gameSelectorOpen}
        library={session.library}
        selectedGame={session.selectedGame}
        selecting={session.selecting}
        onSelect={(game) => {
          void session.selectGame(game).then((selected) => {
            if (selected) setGameSelectorOpen(false)
          })
        }}
        onClose={() => setGameSelectorOpen(false)}
      />
      <RemotePlayConfirmations
        reloadOpen={reloadConfirmOpen}
        quitOpen={quitConfirmOpen}
        onCloseReload={() => setReloadConfirmOpen(false)}
        onCloseQuit={() => setQuitConfirmOpen(false)}
        onReload={executeHardReload}
        onQuit={() => void executeQuitGame()}
      />
      {/* Hidden WebKit Switch element for iOS Safari Taptic Engine feedback */}
      <div
        style={{
          position: 'fixed',
          top: -100,
          left: -100,
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
        aria-hidden="true"
      >
        <input type="checkbox" {...{ switch: '' }} id="chaya-haptic-switch" tabIndex={-1} readOnly />
        <label htmlFor="chaya-haptic-switch" id="chaya-haptic-label" />
      </div>
    </main>
  )
}
