/**
 * In-game WebRTC MediaStream capture and remote touch/key input simulation.
 * Captures canvas via captureStream(60) and pipes WebAudio to RTC peer.
 */
import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'

import { ChayaLog } from '../net/logger'

const KEY_MAP: Record<RemoteInputKey, { key: string; code: string; keyCode: number }> = {
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ok: { key: 'Enter', code: 'Enter', keyCode: 13 },
  cancel: { key: 'Escape', code: 'Escape', keyCode: 27 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  menu: { key: 'Escape', code: 'Escape', keyCode: 27 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
}

export function getGameCanvas(): HTMLCanvasElement | null {
  const g = globalThis as unknown as { Graphics?: { _canvas?: HTMLCanvasElement }; document?: Document }
  return g.Graphics?._canvas || g.document?.querySelector<HTMLCanvasElement>('#GameCanvas') || g.document?.querySelector<HTMLCanvasElement>('canvas') || null
}

let cachedStream: MediaStream | null = null
let cachedCanvas: HTMLCanvasElement | null = null
let cachedAudioContext: AudioContext | null = null
let cachedAudioDest: MediaStreamAudioDestinationNode | null = null
const mediaPeers = new Set<RTCPeerConnection>()
let stopRenderKeepalive: (() => void) | null = null

export function closeGameMediaPeer(peer: RTCPeerConnection | null): void {
  if (!peer) return
  mediaPeers.delete(peer)
  try {
    peer.close()
  } catch {
    /* The runtime may already have disposed this peer. */
  }
  if (mediaPeers.size) return
  cachedStream?.getVideoTracks().forEach((track) => track.stop())
  cachedStream = null
  cachedCanvas = null
  stopRenderKeepalive?.()
  stopRenderKeepalive = null
}

/**
 * Evaluates whether host machine physical speakers should be muted.
 * ONLY mute if the game is running as a cloud instance in silent / background mode.
 * Ordinary launches and visible/windowed games must keep host audio playing.
 */
export function shouldMuteHostAudio(): boolean {
  try {
    const g = globalThis as any
    if (g.__CHAYA_MUTE_HOST__ === true || g.__CHAYA_ENV__?.muteHostAudio === true) return true
    const isSilent = Boolean(g.CHAYA_SILENT_MODE || g.__CHAYA_SILENT_MODE__)
    if (!isSilent) return false
    if (g.__CHAYA_UNMUTE_HOST__ === true) return false
    if (g.__CHAYA_MUTE_HOST__ === false) return false
    return true
  } catch {
    return false
  }
}

/**
 * Isolates WebAudio: disconnects host machine physical speakers (ctx.destination)
 * ONLY when running as a cloud gaming instance in background / silent mode.
 * In all other cases (normal local launch, windowed mode), host speakers keep playing music.
 * Preserves piping audio into MediaStreamDestination for WebRTC streaming in all cases.
 */
export function isolateHostAudio(unmuteHost?: boolean): void {
  try {
    const g = globalThis as any
    const WebAudio = g.WebAudio
    const ctx = WebAudio?._context as AudioContext | undefined
    const gain = WebAudio?._masterGainNode as GainNode | undefined
    if (!ctx || !gain) return

    const effectiveUnmute = typeof unmuteHost === 'boolean' ? unmuteHost : !shouldMuteHostAudio()

    // 1. Physical speaker control
    if (!effectiveUnmute) {
      try {
        gain.disconnect(ctx.destination)
        ;(gain as any).__chaya_host_muted = true
      } catch {
        /* ignore if already disconnected or not supported */
      }
    } else {
      // Reconnect physical speaker if it was previously muted or explicitly requested
      if ((gain as any).__chaya_host_muted || unmuteHost === true) {
        try {
          gain.connect(ctx.destination)
        } catch {
          /* already connected */
        }
        ;(gain as any).__chaya_host_muted = false
      }
    }

    // 2. Connect to WebRTC MediaStream destination
    if (cachedAudioContext !== ctx || cachedAudioDest?.stream.getAudioTracks().some((track) => track.readyState === 'ended')) {
      cachedAudioDest = null
      cachedAudioContext = ctx
    }
    if (!cachedAudioDest && typeof ctx.createMediaStreamDestination === 'function') {
      cachedAudioDest = ctx.createMediaStreamDestination()
    }

    if (cachedAudioDest) {
      try {
        gain.connect(cachedAudioDest)
      } catch {
        /* already connected */
      }
      const audio = cachedAudioDest.stream.getAudioTracks().find((track) => track.readyState !== 'ended')
      if (cachedStream && audio) {
        for (const track of cachedStream.getAudioTracks()) if (track !== audio) cachedStream.removeTrack(track)
        if (!cachedStream.getAudioTracks().includes(audio)) cachedStream.addTrack(audio)
        for (const peer of mediaPeers) {
          for (const sender of peer.getSenders?.() || []) {
            if (sender.track?.kind === 'audio' && sender.track !== audio) {
              void sender.replaceTrack(audio).catch((error) => ChayaLog.warn('RemoteStream', 'Audio track replacement failed', error))
            }
          }
        }
      }
    }
  } catch (err) {
    ChayaLog.warn('RemoteStream', 'isolateHostAudio failed', err)
  }
}

export function handleHostAudioToggle(unmute: boolean): void {
  ;(globalThis as any).__CHAYA_UNMUTE_HOST__ = unmute
  isolateHostAudio(unmute)
}

/**
 * Hooks WebAudio.initialize so that audio isolation takes effect immediately
 * when the game initializes sound, before any title BGM plays out of host speakers.
 */
export function hookWebAudioMuting(): void {
  try {
    const g = globalThis as any
    const WebAudio = g.WebAudio
    if (!WebAudio) return

    if (typeof WebAudio.initialize === 'function' && !WebAudio.__chaya_audio_hooked) {
      WebAudio.__chaya_audio_hooked = true
      const origInit = WebAudio.initialize
      WebAudio.initialize = function (...args: any[]) {
        const res = origInit.apply(this, args)
        try {
          isolateHostAudio()
        } catch {
          /* */
        }
        return res
      }
    }

    if (WebAudio._masterGainNode) {
      isolateHostAudio()
    }
  } catch {
    /* */
  }
}

/**
 * If running inside NW.js and silentMode was requested, immediately hide the desktop window.
 */
export function applySilentWindowHiding(): void {
  try {
    const g = globalThis as any
    const isSilent = Boolean(g.CHAYA_SILENT_MODE || g.__CHAYA_SILENT_MODE__)
    if (!isSilent) return

    const nw = g.nw
    const win = nw?.Window?.get?.()
    if (win && typeof win.hide === 'function') {
      win.hide()
      if (typeof win.setShowInTaskbar === 'function') {
        win.setShowInTaskbar(false)
      }
    }
  } catch {
    /* */
  }
}

export function captureGameMediaStream(): MediaStream | null {
  try {
    const canvas = getGameCanvas()
    if (!canvas || typeof canvas.captureStream !== 'function') return null

    const reuse = cachedCanvas === canvas && cachedStream?.active && cachedStream.getVideoTracks()[0]?.readyState === 'live'
    const stream = reuse ? cachedStream! : canvas.captureStream(60)
    cachedStream = stream
    cachedCanvas = canvas

    // Pipe game WebAudio if audio context is available
    try {
      const g = globalThis as any
      const ctx = g.WebAudio?._context as AudioContext | undefined
      if (ctx) {
        isolateHostAudio(Boolean(g.__CHAYA_UNMUTE_HOST__))
        if (cachedAudioDest) {
          const tracks = cachedAudioDest.stream.getAudioTracks()
          for (const old of stream.getAudioTracks()) {
            if (!tracks.includes(old)) stream.removeTrack(old)
          }
          for (const track of tracks) {
            if (track.readyState !== 'ended' && !stream.getAudioTracks().includes(track)) stream.addTrack(track)
          }
        }
      }
    } catch (err) {
      ChayaLog.warn('RemoteStream', 'WebAudio capture skipped', err)
    }

    return stream
  } catch (err) {
    ChayaLog.warn('RemoteStream', 'Canvas captureStream failed', err)
    return null
  }
}

function preferH264(tr: RTCRtpTransceiver) {
  try {
    const RTCSender = (globalThis as unknown as { RTCRtpSender?: { getCapabilities?: (kind: string) => { codecs?: { mimeType: string }[] } } }).RTCRtpSender
    if (typeof RTCSender?.getCapabilities === 'function' && typeof tr.setCodecPreferences === 'function') {
      const caps = RTCSender.getCapabilities('video')
      if (caps?.codecs) {
        const h264 = caps.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'video/h264')
        const others = caps.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'video/h264')
        if (h264.length > 0) {
          tr.setCodecPreferences([...h264, ...others] as any)
        }
      }
    }
  } catch {
    /* */
  }
}

/**
 * Supplements stalled native rendering without adding a second animation loop.
 * OS sleep and compositor suspension remain outside the plugin's control.
 */
export function ensureGameRenderKeepalive(): void {
  hookWebAudioMuting()
  applySilentWindowHiding()
  try {
    const g = globalThis as any
    const sm = g.SceneManager
    if (!sm) return
    if (sm.__chaya_stream_keepalive) return

    // MV owns its animation loop; MZ delegates updates and rendering to PIXI.
    const usesSceneLoop = typeof sm.requestUpdate === 'function'
    const ticker = g.Graphics?._app?.ticker
    const loop = usesSceneLoop ? sm : ticker
    if (typeof loop?.update !== 'function') return
    sm.__chaya_stream_keepalive = true

    const originalIsActive = sm.isGameActive
    const isActive = () => true
    if (typeof originalIsActive === 'function') sm.isGameActive = isActive

    let fallbackUpdating = false
    let lastNativeUpdate = performance.now()
    let lastAnyUpdate = lastNativeUpdate
    const updateMethod = usesSceneLoop && typeof sm.renderScene === 'function' ? 'renderScene' : 'update'
    const originalUpdate = loop[updateMethod]
    const update = function (this: any, ...args: any[]) {
      lastAnyUpdate = performance.now()
      if (!fallbackUpdating) lastNativeUpdate = lastAnyUpdate
      return originalUpdate.apply(this, args)
    }
    loop[updateMethod] = update

    const originalRequestUpdate = sm.requestUpdate
    let requestUpdate: ((...args: any[]) => void) | undefined
    if (usesSceneLoop) {
      requestUpdate = function (this: any, ...args: any[]) {
        // A timer-driven MV update must not enqueue another native animation loop.
        if (!fallbackUpdating) return originalRequestUpdate.apply(this, args)
      }
      sm.requestUpdate = requestUpdate
    }

    // Native frames take priority. Keep a 60 Hz timer only for suspended RAF.
    const timer = setInterval(() => {
      const now = performance.now()
      if (sm._stopped || (!usesSceneLoop && !ticker.started) || now - lastNativeUpdate < 50 || now - lastAnyUpdate < 16) return
      fallbackUpdating = true
      try {
        if (usesSceneLoop) sm.update()
        else ticker.update(now)
      } catch {
        /* The engine handles its own render errors. */
      } finally {
        fallbackUpdating = false
      }
    }, 1000 / 60)
    stopRenderKeepalive = () => {
      clearInterval(timer)
      if (loop[updateMethod] === update) loop[updateMethod] = originalUpdate
      if (sm.requestUpdate === requestUpdate) sm.requestUpdate = originalRequestUpdate
      if (sm.isGameActive === isActive) sm.isGameActive = originalIsActive
      sm.__chaya_stream_keepalive = false
    }
  } catch {
    /* */
  }
}

export function handleRequestKeyframe(): void {
  try {
    const g = globalThis as unknown as { SceneManager?: { renderScene?: () => void } }
    g.SceneManager?.renderScene?.()
  } catch {
    /* */
  }
}

export async function attachGameMediaStream(peer: RTCPeerConnection): Promise<void> {
  const stream = captureGameMediaStream()
  if (!stream) return
  mediaPeers.add(peer)
  ensureGameRenderKeepalive()

  const videoTrack = stream.getVideoTracks()[0]
  const audioTrack = stream.getAudioTracks()[0]

  if (videoTrack) {
    try {
      ;(videoTrack as any).contentHint = 'motion'
    } catch {}
  }

  const transceivers = typeof peer.getTransceivers === 'function' ? peer.getTransceivers() : []
  let attachedVideo = false
  let attachedAudio = false

  for (const tr of transceivers) {
    const kind = tr.receiver?.track?.kind
    if (kind === 'video' && videoTrack) {
      tr.direction = 'sendonly'
      try {
        await tr.sender.replaceTrack(videoTrack)
      } catch {}
      preferH264(tr)
      attachedVideo = true
    } else if (kind === 'audio' && audioTrack) {
      tr.direction = 'sendonly'
      try {
        await tr.sender.replaceTrack(audioTrack)
      } catch {}
      attachedAudio = true
    }
  }

  if (!attachedVideo && videoTrack) {
    const sender = peer.addTrack(videoTrack, stream)
    const tr = (typeof peer.getTransceivers === 'function' ? peer.getTransceivers() : []).find((t) => t.sender === sender)
    if (tr) preferH264(tr)
  }
  if (!attachedAudio && audioTrack) {
    peer.addTrack(audioTrack, stream)
  }

  // Sender limits remain adaptive; they do not guarantee throughput or frame rate.
  for (const sender of peer.getSenders?.() || []) {
    if (sender.track?.kind === 'video' && typeof sender.getParameters === 'function') {
      try {
        const p = sender.getParameters()
        if (!p.encodings || p.encodings.length === 0) p.encodings = [{}]
        p.encodings[0].maxBitrate = 16_000_000
        p.encodings[0].maxFramerate = 60
        p.encodings[0].networkPriority = 'high'
        p.degradationPreference = 'maintain-framerate'
        sender.setParameters(p).catch(() => {})
      } catch {}
    }
  }
}

interface GameInputState {
  _currentState?: Record<string, boolean>
  _latestButton?: string | null
  _pressedTime?: number
  _date?: number
  keyMapper?: Record<number, string>
}

interface GameTouchInputState {
  _cancelled?: boolean
  _events?: { cancelled?: boolean; triggered?: boolean; [key: string]: unknown }
  _onCancel?: (x: number, y: number) => void
  _x?: number
  _y?: number
}

const activeReleaseTimers = new Map<RemoteInputKey, ReturnType<typeof setTimeout>>()
const lastPressTime = new Map<RemoteInputKey, number>()
const MIN_PRESS_MS = 50

function applyInputState(key: RemoteInputKey, action: 'down' | 'up'): void {
  // 1. RPG Maker Input state engine
  try {
    const Input = (globalThis as unknown as { Input?: GameInputState }).Input
    if (Input && Input._currentState) {
      const isDown = action === 'down'
      const isCancelOrMenu = key === 'cancel' || key === 'menu'
      const effectiveKey = isCancelOrMenu ? 'escape' : key

      Input._currentState[key] = isDown
      Input._currentState[effectiveKey] = isDown
      if (isCancelOrMenu) {
        Input._currentState['cancel'] = isDown
        Input._currentState['escape'] = isDown
        Input._currentState['menu'] = isDown
      }

      if (isDown) {
        Input._latestButton = effectiveKey
        Input._pressedTime = 0
        Input._date = Date.now()
      } else {
        if (Input._latestButton === effectiveKey || Input._latestButton === key) {
          Input._latestButton = null
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 2. RPG Maker TouchInput cancellation (crucial for mobile plugins & touch dialogs)
  if ((key === 'cancel' || key === 'menu') && action === 'down') {
    try {
      const TouchInput = (globalThis as unknown as { TouchInput?: GameTouchInputState }).TouchInput
      if (TouchInput) {
        TouchInput._cancelled = true
        if (TouchInput._events) {
          TouchInput._events.cancelled = true
        }
        if (typeof TouchInput._onCancel === 'function') {
          const g = (globalThis as unknown as { Graphics?: { boxWidth?: number; boxHeight?: number } }).Graphics
          const cx = g?.boxWidth ? g.boxWidth / 2 : TouchInput._x || 0
          const cy = g?.boxHeight ? g.boxHeight / 2 : TouchInput._y || 0
          TouchInput._onCancel(cx, cy)
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Dispatch KeyboardEvent for RPG Maker event handlers & plugins
  try {
    const meta = KEY_MAP[key]
    if (meta && typeof document !== 'undefined') {
      const dispatchSyntheticKey = (k: string, c: string, kc: number) => {
        const ev = new KeyboardEvent(action === 'down' ? 'keydown' : 'keyup', {
          key: k,
          code: c,
          bubbles: true,
          cancelable: true,
        })
        try {
          Object.defineProperty(ev, 'keyCode', { value: kc, configurable: true, enumerable: true })
          Object.defineProperty(ev, 'which', { value: kc, configurable: true, enumerable: true })
        } catch {
          /* ignore */
        }
        document.dispatchEvent(ev)
        if (typeof window !== 'undefined' && window !== (document as unknown)) {
          window.dispatchEvent(ev)
        }
      }

      dispatchSyntheticKey(meta.key, meta.code, meta.keyCode)

      // For cancel/escape: additionally dispatch KeyX (keyCode 88), which is standard secondary RPG Maker Cancel/Menu key
      if ((key === 'cancel' || key === 'menu') && meta.keyCode === 27) {
        dispatchSyntheticKey('x', 'KeyX', 88)
      }
    }
  } catch {
    /* ignore */
  }
}

export function handleRemoteInput(key: RemoteInputKey, action: 'down' | 'up'): void {
  const existingTimer = activeReleaseTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
    activeReleaseTimers.delete(key)
  }

  if (action === 'down') {
    lastPressTime.set(key, Date.now())
    applyInputState(key, 'down')
  } else {
    const pressStart = lastPressTime.get(key) || 0
    const elapsed = Date.now() - pressStart
    if (elapsed < MIN_PRESS_MS && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
      const remaining = MIN_PRESS_MS - elapsed
      const timer = setTimeout(() => {
        activeReleaseTimers.delete(key)
        applyInputState(key, 'up')
      }, remaining)
      activeReleaseTimers.set(key, timer)
    } else {
      applyInputState(key, 'up')
    }
  }
}

export function handleRemoteTap(normX: number, normY: number, phase: 'down' | 'move' | 'up'): void {
  try {
    const canvas = getGameCanvas()
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.left + normX * rect.width
    const clientY = rect.top + normY * rect.height

    const evType = phase === 'down' ? 'mousedown' : phase === 'up' ? 'mouseup' : 'mousemove'
    const mouseEv = new MouseEvent(evType, {
      clientX,
      clientY,
      button: 0,
      buttons: phase === 'up' ? 0 : 1,
      bubbles: true,
      cancelable: true,
    })

    const TouchInput = (
      globalThis as unknown as { TouchInput?: { _onMouseDown?: (e: MouseEvent) => void; _onMouseUp?: (e: MouseEvent) => void; _onMouseMove?: (e: MouseEvent) => void } }
    ).TouchInput
    if (TouchInput) {
      if (phase === 'down') TouchInput._onMouseDown?.(mouseEv)
      else if (phase === 'up') TouchInput._onMouseUp?.(mouseEv)
      else TouchInput._onMouseMove?.(mouseEv)
    }
    canvas.dispatchEvent(mouseEv)
  } catch {
    /* */
  }
}

if (typeof window !== 'undefined') {
  hookWebAudioMuting()
  applySilentWindowHiding()
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        hookWebAudioMuting()
        applySilentWindowHiding()
      })
    }
  }
}
