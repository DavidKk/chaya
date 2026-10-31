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
let audioConnected = false
let cachedAudioDest: MediaStreamAudioDestinationNode | null = null

/**
 * Isolates WebAudio: disconnects host machine physical speakers (ctx.destination)
 * and pipes audio exclusively into a MediaStreamDestination for WebRTC streaming.
 */
export function isolateHostAudio(unmuteHost = false): void {
  try {
    const g = globalThis as any
    const WebAudio = g.WebAudio
    const ctx = WebAudio?._context as AudioContext | undefined
    const gain = WebAudio?._masterGainNode as GainNode | undefined
    if (!ctx || !gain) return

    // 1. Unless explicit unmute is requested, disconnect from host speakers (Mac 0 dB silence)
    if (!unmuteHost) {
      try {
        gain.disconnect()
      } catch {
        /* ignore if already disconnected or not supported */
      }
    }

    // 2. Connect to WebRTC MediaStream destination
    if (!cachedAudioDest && typeof ctx.createMediaStreamDestination === "function") {
      cachedAudioDest = ctx.createMediaStreamDestination()
    }

    if (cachedAudioDest) {
      try {
        gain.connect(cachedAudioDest)
      } catch {
        /* already connected */
      }
    }

    // 3. If unmuting requested, reconnect physical speaker
    if (unmuteHost) {
      try {
        gain.connect(ctx.destination)
      } catch {
        /* */
      }
    }
  } catch (err) {
    ChayaLog.warn("RemoteStream", "isolateHostAudio failed", err)
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

    if (typeof WebAudio.initialize === "function" && !WebAudio.__chaya_audio_hooked) {
      WebAudio.__chaya_audio_hooked = true
      const origInit = WebAudio.initialize
      WebAudio.initialize = function (...args: any[]) {
        const res = origInit.apply(this, args)
        try {
          isolateHostAudio(Boolean(g.__CHAYA_UNMUTE_HOST__))
        } catch {
          /* */
        }
        return res
      }
    }

    if (WebAudio._masterGainNode) {
      isolateHostAudio(Boolean(g.__CHAYA_UNMUTE_HOST__))
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
    if (win && typeof win.hide === "function") {
      win.hide()
      if (typeof win.setShowInTaskbar === "function") {
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

    if (
      cachedStream &&
      cachedStream.active &&
      cachedStream.getVideoTracks().length > 0 &&
      cachedStream.getVideoTracks()[0].readyState === 'live'
    ) {
      return cachedStream
    }

    const stream = canvas.captureStream(60)
    cachedStream = stream

    // Pipe game WebAudio if audio context is available
    try {
      const g = globalThis as any
      const ctx = g.WebAudio?._context as AudioContext | undefined
      if (ctx) {
        isolateHostAudio(Boolean(g.__CHAYA_UNMUTE_HOST__))
        if (cachedAudioDest && !audioConnected) {
          audioConnected = true
          for (const track of cachedAudioDest.stream.getAudioTracks()) {
            stream.addTrack(track)
          }
        }
      }
    } catch (err) {
      ChayaLog.warn("RemoteStream", "WebAudio capture skipped", err)
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
 * Ensures game render loop continues ticking when host computer locks screen or minimizes.
 * Chromium suspends requestAnimationFrame when screen is locked or window is hidden,
 * which halts canvas rendering and freezes WebRTC video capture.
 */
export function ensureGameRenderKeepalive(): void {
  hookWebAudioMuting()
  applySilentWindowHiding()
  try {
    const g = globalThis as unknown as { SceneManager?: any }
    const sm = g.SceneManager
    if (!sm) return
    if (sm.__chaya_stream_keepalive) return
    sm.__chaya_stream_keepalive = true

    // 1. Prevent RPG Maker from sleeping or pausing when window loses focus or screen locks
    if (typeof sm.isGameActive === "function") {
      sm.isGameActive = () => true
    }

    // 2. Track last frame render time
    let lastRenderTime = Date.now()
    const origRenderScene = sm.renderScene
    if (typeof origRenderScene === "function") {
      sm.renderScene = function (...args: any[]) {
        lastRenderTime = Date.now()
        return origRenderScene.apply(this, args)
      }
    }

    // 3. Fallback ticker: if requestAnimationFrame is suspended for > 65ms,
    // invoke sm.update() or sm.renderScene() to ensure canvas has fresh pixels
    setInterval(() => {
      if (!sm._stopped && Date.now() - lastRenderTime > 65) {
        lastRenderTime = Date.now()
        try {
          if (typeof sm.update === "function") {
            sm.update()
          } else if (typeof sm.renderScene === "function") {
            sm.renderScene()
          }
        } catch {
          /* */
        }
      }
    }, 40)
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
  ensureGameRenderKeepalive()
  const stream = captureGameMediaStream()
  if (!stream) return

  const videoTrack = stream.getVideoTracks()[0]
  const audioTrack = stream.getAudioTracks()[0]

  const transceivers = typeof peer.getTransceivers === 'function' ? peer.getTransceivers() : []
  let attachedVideo = false
  let attachedAudio = false

  for (const tr of transceivers) {
    const kind = tr.receiver?.track?.kind
    if (kind === 'video' && videoTrack) {
      tr.direction = 'sendonly'
      try { await tr.sender.replaceTrack(videoTrack) } catch {}
      preferH264(tr)
      attachedVideo = true
    } else if (kind === 'audio' && audioTrack) {
      tr.direction = 'sendonly'
      try { await tr.sender.replaceTrack(audioTrack) } catch {}
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
          const cx = g?.boxWidth ? g.boxWidth / 2 : (TouchInput._x || 0)
          const cy = g?.boxHeight ? g.boxHeight / 2 : (TouchInput._y || 0)
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

if (typeof window !== "undefined") {
  hookWebAudioMuting()
  applySilentWindowHiding()
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        hookWebAudioMuting()
        applySilentWindowHiding()
      })
    }
  }
}
