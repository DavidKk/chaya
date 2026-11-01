'use client'

import { type PointerEvent, type RefObject, useCallback, useEffect, useState } from 'react'
import { LuMaximize2, LuMinimize2, LuPower, LuScaling, LuSlidersHorizontal, LuSparkles, LuVolume2, LuVolumeX } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import type { WebGameLink } from '@/lib/runtime/web-game-link'

import { haptic } from './haptic'
import { PerformanceHud } from './PerformanceHud'
import { RemotePlayBackground } from './RemotePlayBackground'
import { type ControlMode, VirtualController } from './VirtualController'

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>
  streamRef: RefObject<MediaStream | null>
  linkRef: RefObject<WebGameLink | null>
  coverImage: string | null
  connected: boolean
  isSpectator?: boolean
  isPortrait: boolean
  isDesktop: boolean
  muted: boolean
  fitMode: 'contain' | 'cover'
  isFullscreen: boolean
  isStandalone: boolean
  idle: boolean
  hudVisible: boolean
  latencyMs: number | null
  videoFps: number | null
  videoResolution: { width: number; height: number } | null
  controlMode: ControlMode
  controllerOpacity: number
  autoTalk: boolean
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  onAction: (id: string) => void
  onDrawer: () => void
  onMenu: () => void
  onQuit: () => void
  onMute: () => void
  onFit: () => void
  onFullscreen: () => void
  onHideHud: () => void
  onResolution: (resolution: { width: number; height: number }) => void
  onPlaying: () => void
}

export function RemotePlaySurface(props: Props) {
  const t = useT()
  const { videoRef, streamRef, linkRef, muted } = props
  const [snapshotKey, setSnapshotKey] = useState(() => Date.now())
  const [hasVideoFeed, setHasVideoFeed] = useState(false)

  // 监视视频流是否有效，若无 live video track 则定期刷新快照兜底，保证原生 RGSS / 启动阶段不黑屏
  useEffect(() => {
    if (!props.connected || hasVideoFeed) return
    const timer = setInterval(() => {
      setSnapshotKey(Date.now())
    }, 1500)
    return () => clearInterval(timer)
  }, [props.connected, hasVideoFeed])

  const onVideoPlaying = () => {
    setHasVideoFeed(true)
    props.onPlaying()
  }
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el
      if (!el) return
      el.muted = muted
      el.setAttribute('playsinline', 'true')
      el.setAttribute('webkit-playsinline', 'true')
      if (streamRef.current && el.srcObject !== streamRef.current) {
        el.srcObject = streamRef.current
        void el.play().catch(() => {})
      }
    },
    [videoRef, streamRef, muted]
  )

  const handlePointer = (e: PointerEvent<HTMLElement>, phase: 'down' | 'move' | 'up') => {
    const el = e.currentTarget
    if (!el || !linkRef.current?.connected) return
    const video = videoRef.current
    if (props.isSpectator) {
      if (phase === 'down' && video && video.paused) void video.play().catch(() => {})
      return
    }
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    if (phase === 'down') {
      haptic.trigger('light')
      e.currentTarget.setPointerCapture?.(e.pointerId)
      if (video && video.paused) void video.play().catch(() => {})
    }
    linkRef.current.send({
      type: 'remote.tap',
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      phase,
    })
  }

  const handleLoaded = () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    props.onResolution({ width: video.videoWidth, height: video.videoHeight })
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden select-none">
      <RemotePlayBackground image={props.coverImage} variant="surface" />
      <video
        ref={setVideoRef}
        autoPlay
        playsInline
        muted={muted}
        onLoadedMetadata={handleLoaded}
        onResize={handleLoaded}
        onPlaying={onVideoPlaying}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!props.isSpectator) {
            props.onInput('menu', 'down')
            setTimeout(() => props.onInput('menu', 'up'), 50)
          }
        }}
        onPointerDown={(e) => handlePointer(e, 'down')}
        onPointerMove={(e) => handlePointer(e, 'move')}
        onPointerUp={(e) => handlePointer(e, 'up')}
        onPointerCancel={(e) => handlePointer(e, 'up')}
        className={`relative z-10 max-h-full max-w-full cursor-crosshair touch-none ${hasVideoFeed ? (props.fitMode === 'cover' ? 'h-full w-full object-cover' : 'object-contain') : 'hidden'}`}
        style={props.videoResolution && props.fitMode !== 'cover' ? { aspectRatio: `${props.videoResolution.width} / ${props.videoResolution.height}` } : undefined}
      />
      {!hasVideoFeed && props.connected && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/remote/screenshot?roomId=${encodeURIComponent(linkRef.current?.roomId || '')}&t=${snapshotKey}`}
          alt="Remote Game"
          onLoad={(e) => {
            const el = e.currentTarget
            if (el.naturalWidth && el.naturalHeight) {
              props.onResolution({ width: el.naturalWidth, height: el.naturalHeight })
            }
          }}
          className={`relative z-10 max-h-full max-w-full cursor-crosshair touch-none select-none ${props.fitMode === 'cover' ? 'h-full w-full object-cover' : 'object-contain'}`}
          style={props.videoResolution && props.fitMode !== 'cover' ? { aspectRatio: `${props.videoResolution.width} / ${props.videoResolution.height}` } : undefined}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!props.isSpectator) {
              props.onInput('menu', 'down')
              setTimeout(() => props.onInput('menu', 'up'), 50)
            }
          }}
          onPointerDown={(e) => handlePointer(e, 'down')}
          onPointerMove={(e) => handlePointer(e, 'move')}
          onPointerUp={(e) => handlePointer(e, 'up')}
          onPointerCancel={(e) => handlePointer(e, 'up')}
        />
      )}
      {props.connected && (
        <>
          {props.isSpectator && (
            <div
              className="pointer-events-none fixed z-40 flex items-center gap-1.5 rounded-full border border-accent/40 bg-panel/90 px-3 py-1 shadow-lg backdrop-blur-md"
              style={{ top: 'max(0.5rem, env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)' }}
            >
              <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse" />
              <span className="text-xs font-semibold text-accent">{t('play.spectatorMode')}</span>
            </div>
          )}
          <PerformanceHud
            visible={props.hudVisible}
            idle={props.idle}
            isStandalone={props.isStandalone}
            latencyMs={props.latencyMs}
            fps={props.videoFps}
            videoResolution={props.videoResolution}
            status="connected"
            muted={muted}
            onClose={props.onHideHud}
          />
          {props.isDesktop && !props.isPortrait ? (
            <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" style={{ top: 'max(0.5rem, env(safe-area-inset-top))' }}>
              <div className="pointer-events-auto flex items-center gap-2 rounded-[0.35rem] border border-line bg-panel/90 p-2 backdrop-blur-md">
                <span className="px-2 font-mono text-[11px] text-ink-soft">{props.latencyMs != null ? `${props.latencyMs}ms` : t('play.connected')}</span>
                <Button size="icon" variant="plain" onClick={props.onMute} aria-label={t(muted ? 'play.unmuted' : 'play.muted')}>
                  {muted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
                </Button>
                <Button size="icon" variant="plain" onClick={props.onFit} aria-label={t(props.fitMode === 'cover' ? 'play.fitCover' : 'play.fitContain')}>
                  <LuScaling size={16} />
                </Button>
                {!props.isStandalone && (
                  <Button size="icon" variant="plain" onClick={props.onFullscreen} aria-label={t('play.fullscreen')}>
                    {props.isFullscreen ? <LuMinimize2 size={16} /> : <LuMaximize2 size={16} />}
                  </Button>
                )}
                <Button size="icon" variant="plain" onClick={props.onDrawer} aria-label={t('play.inGameConsole')}>
                  <LuSparkles size={16} />
                </Button>
                <Button size="icon" variant="plain" onClick={props.onMenu} aria-label={t('play.consoleTitle')}>
                  <LuSlidersHorizontal size={16} />
                </Button>
                <Button size="icon" variant="plain" onClick={props.onQuit} aria-label={t(props.isSpectator ? 'play.exitSpectator' : 'play.quitGame')}>
                  <LuPower size={16} />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="icon"
              onClick={props.onMenu}
              aria-label={t('play.consoleTitle')}
              className="absolute z-40 bg-panel/85"
              style={{ top: 'max(0.5rem, env(safe-area-inset-top))', right: 'max(0.75rem, env(safe-area-inset-right))' }}
            >
              <LuSlidersHorizontal size={16} />
            </Button>
          )}
          {!props.isDesktop && !props.isSpectator && (
            <VirtualController
              onInput={props.onInput}
              onAction={props.onAction}
              onOpenDrawer={props.onDrawer}
              visible
              idle={props.idle}
              isPortrait={props.isPortrait}
              mode={props.controlMode}
              opacity={props.controllerOpacity}
              autoTalk={props.autoTalk}
            />
          )}
        </>
      )}
    </div>
  )
}
