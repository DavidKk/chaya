import type { LogLevel } from '@/lib/log/types'

export interface RemotePlayLogEntry {
  id: string
  ts: number
  level: LogLevel
  source: 'remote-play'
  message: string
  meta?: Record<string, unknown>
}

export interface DeviceDiagnostics {
  userAgent: string
  platform: string
  os: string
  browser: string
  isIOS: boolean
  isSafari: boolean
  isMobile: boolean
  screen: {
    width: number
    height: number
    dpr: number
  }
  viewport: {
    width: number
    height: number
  }
  maxTouchPoints: number
  webrtcSupported: boolean
  h264Supported: boolean
}

export function detectDeviceDiagnostics(): DeviceDiagnostics {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : ''
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (platform === 'MacIntel' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua)
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)

  let os = platform || 'Unknown OS'
  if (isIOS) os = 'iOS / iPadOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'Unknown Browser'
  if (/MicroMessenger/i.test(ua)) browser = 'WeChat'
  else if (/CriOS|Chrome/i.test(ua)) browser = 'Chrome'
  else if (/EdgiOS|Edge|Edg/i.test(ua)) browser = 'Edge'
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'Firefox'
  else if (isSafari) browser = 'Safari'

  let webrtcSupported = false
  let h264Supported = false
  if (typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined') {
    webrtcSupported = true
    const RTCCapabilities = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver : null
    if (typeof RTCCapabilities?.getCapabilities === 'function') {
      try {
        const caps = RTCCapabilities.getCapabilities('video')
        h264Supported = Boolean(caps?.codecs?.some((c) => c.mimeType.toLowerCase() === 'video/h264'))
      } catch {
        /* ignore */
      }
    }
  }

  return {
    userAgent: ua,
    platform,
    os,
    browser,
    isIOS,
    isSafari,
    isMobile,
    screen: {
      width: typeof window !== 'undefined' && window.screen ? window.screen.width : 0,
      height: typeof window !== 'undefined' && window.screen ? window.screen.height : 0,
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    },
    viewport: {
      width: typeof window !== 'undefined' ? window.innerWidth : 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
    },
    maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
    webrtcSupported,
    h264Supported,
  }
}

const MAX_BUFFER_ENTRIES = 200
const MAX_PENDING_SYNC = 100
const FLUSH_INTERVAL_MS = 3500

export class RemotePlayLogger {
  private buffer: RemotePlayLogEntry[] = []
  private pendingSync: RemotePlayLogEntry[] = []
  private listeners = new Set<(entries: RemotePlayLogEntry[]) => void>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private isFlushing = false
  private diagnostics: DeviceDiagnostics | null = null
  private handlersInstalled = false
  private initialized = false
  private seq = 0

  getDiagnostics(): DeviceDiagnostics {
    if (!this.diagnostics) {
      this.diagnostics = detectDeviceDiagnostics()
    }
    return this.diagnostics
  }

  initEnvironmentDiagnostics() {
    if (this.initialized) return
    this.initialized = true
    const diag = this.getDiagnostics()
    this.info('Client environment diagnostics initialized', {
      os: diag.os,
      browser: diag.browser,
      isIOS: diag.isIOS,
      isSafari: diag.isSafari,
      screen: `${diag.screen.width}x${diag.screen.height}@${diag.screen.dpr}x`,
      viewport: `${diag.viewport.width}x${diag.viewport.height}`,
      touchPoints: diag.maxTouchPoints,
      webrtcSupported: diag.webrtcSupported,
      h264Supported: diag.h264Supported,
    })
  }

  installGlobalErrorHandlers() {
    if (this.handlersInstalled || typeof window === 'undefined') return
    this.handlersInstalled = true

    window.addEventListener('error', (event) => {
      this.fail(`Uncaught page error: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      })
    })

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      const msg = reason instanceof Error ? reason.message : String(reason)
      this.fail(`Unhandled promise rejection: ${msg}`, {
        stack: reason instanceof Error ? reason.stack : undefined,
      })
    })

    window.addEventListener('pagehide', () => {
      this.flushOnUnload()
    })
  }

  add(level: LogLevel, message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    this.seq += 1
    const entry: RemotePlayLogEntry = {
      id: `rpl_${Date.now()}_${this.seq}`,
      ts: Date.now(),
      level,
      source: 'remote-play',
      message,
      meta,
    }

    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_ENTRIES)
    }

    this.pendingSync.push(entry)
    if (this.pendingSync.length > MAX_PENDING_SYNC) {
      this.pendingSync.splice(0, this.pendingSync.length - MAX_PENDING_SYNC)
    }

    if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'test') {
      const tag = `[RemotePlay:${level.toUpperCase()}]`
      if (level === 'fail') console.error(tag, message, meta ?? '')
      else if (level === 'warn') console.warn(tag, message, meta ?? '')
      else console.log(tag, message, meta ?? '')
    }

    this.notify()

    if (level === 'fail' || this.pendingSync.length >= 10) {
      void this.flush()
    } else {
      this.scheduleFlush(FLUSH_INTERVAL_MS)
    }

    return entry
  }

  info(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('info', message, meta)
  }

  ok(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('ok', message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('warn', message, meta)
  }

  fail(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('fail', message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('fail', message, meta)
  }

  debug(message: string, meta?: Record<string, unknown>): RemotePlayLogEntry {
    return this.add('debug', message, meta)
  }

  getEntries(): RemotePlayLogEntry[] {
    return [...this.buffer]
  }

  clear() {
    this.buffer = []
    this.notify()
  }

  subscribe(listener: (entries: RemotePlayLogEntry[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.getEntries())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    const snapshot = this.getEntries()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        /* ignore listener error */
      }
    }
  }

  private scheduleFlush(delayMs: number) {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delayMs)
  }

  async flush(): Promise<boolean> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pendingSync.length === 0) return true
    if (this.isFlushing) return false

    this.isFlushing = true
    const toSend = [...this.pendingSync]
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: toSend }),
      })
      if (res.ok) {
        const sentIds = new Set(toSend.map((e) => e.id))
        this.pendingSync = this.pendingSync.filter((e) => !sentIds.has(e.id))
        return true
      }
      return false
    } catch {
      // Retain pending entries on network failure to retry on next flush
      return false
    } finally {
      this.isFlushing = false
    }
  }

  flushOnUnload() {
    if (this.pendingSync.length === 0) return
    const payload = JSON.stringify({ entries: this.pendingSync })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([payload], { type: 'application/json' })
        if (navigator.sendBeacon('/api/logs', blob)) {
          this.pendingSync = []
          return
        }
      } catch {
        /* fallback */
      }
    }
    try {
      void fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* ignore */
    }
  }

  exportAsText(): string {
    const diag = this.getDiagnostics()
    const header = [
      '=== Chaya Remote Play Diagnostic Logs ===',
      `Generated at: ${new Date().toISOString()}`,
      `Operating System: ${diag.os} (${diag.platform || 'Unknown platform'})`,
      `Browser: ${diag.browser} (iOS: ${diag.isIOS ? 'Yes' : 'No'}, Safari: ${diag.isSafari ? 'Yes' : 'No'})`,
      `Screen: ${diag.screen.width}x${diag.screen.height} @${diag.screen.dpr}x (Viewport: ${diag.viewport.width}x${diag.viewport.height})`,
      `Max Touch Points: ${diag.maxTouchPoints}`,
      `WebRTC Supported: ${diag.webrtcSupported ? 'Yes' : 'No'} | H.264 Video Decoder: ${diag.h264Supported ? 'Yes' : 'No'}`,
      '==========================================',
    ].join('\n')

    const body = this.buffer
      .map((e) => {
        const d = new Date(e.ts)
        const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
        const lvl = e.level.toUpperCase().padEnd(5, ' ')
        const metaStr = e.meta ? ` | meta: ${JSON.stringify(e.meta)}` : ''
        return `[${time}] [${lvl}] ${e.message}${metaStr}`
      })
      .join('\n')

    return `${header}\n${body}`
  }
}

export const remotePlayLogger = new RemotePlayLogger()
