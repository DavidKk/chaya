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
      const g = globalThis as unknown as { WebAudio?: { _context?: AudioContext; _masterGainNode?: GainNode } }
      const ctx = g.WebAudio?._context
      const gain = g.WebAudio?._masterGainNode
      if (ctx && gain && !audioConnected && typeof ctx.createMediaStreamDestination === 'function') {
        const dest = ctx.createMediaStreamDestination()
        gain.connect(dest)
        audioConnected = true
        for (const track of dest.stream.getAudioTracks()) {
          stream.addTrack(track)
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
 * Ensures game render loop continues ticking when host computer locks screen or minimizes.
 * Chromium suspends requestAnimationFrame when screen is locked or window is hidden,
 * which halts canvas rendering and freezes WebRTC video capture.
 */
export function ensureGameRenderKeepalive(): void {
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

export function handleRemoteInput(key: RemoteInputKey, action: 'down' | 'up'): void {
  // 1. RPG Maker Input state engine
  try {
    const Input = (globalThis as unknown as { Input?: { _currentState?: Record<string, boolean>; _latestButton?: string; _date?: number } }).Input
    if (Input && Input._currentState) {
      Input._currentState[key] = action === 'down'
      if (key === 'menu' || key === 'cancel') {
        Input._currentState['cancel'] = action === 'down'
        Input._currentState['escape'] = action === 'down'
        Input._currentState['menu'] = action === 'down'
      }
      if (action === 'down') {
        Input._latestButton = key
        Input._date = Date.now()
      }
    }
  } catch {
    /* */
  }

  // 2. Dispatch KeyboardEvent for RPG Maker event handlers & plugins
  try {
    const meta = KEY_MAP[key]
    if (meta && typeof document !== 'undefined') {
      const ev = new KeyboardEvent(action === 'down' ? 'keydown' : 'keyup', {
        key: meta.key,
        code: meta.code,
        keyCode: meta.keyCode,
        which: meta.keyCode,
        bubbles: true,
        cancelable: true,
      })
      document.dispatchEvent(ev)
    }
  } catch {
    /* */
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
