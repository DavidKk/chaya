import { getGamePresence } from '@/services/runtime/presence'

let lastLiveTranslateRequestAt = 0
let activeLiveTranslateRequests = 0

export function recordLiveTranslateActivity(): void {
  lastLiveTranslateRequestAt = Date.now()
}

export function trackLiveTranslateRequest<T>(fn: () => Promise<T>): Promise<T> {
  activeLiveTranslateRequests++
  recordLiveTranslateActivity()
  return fn().finally(() => {
    activeLiveTranslateRequests = Math.max(0, activeLiveTranslateRequests - 1)
    recordLiveTranslateActivity()
  })
}

/** Determine whether the system is in an idle state for background optimization. */
export function isSystemIdleForOptimization(idleWindowMs = 5000): { isIdle: boolean; reason: string } {
  if (activeLiveTranslateRequests > 0) {
    return { isIdle: false, reason: 'Live translate requests in flight' }
  }
  const presence = getGamePresence()
  const now = Date.now()
  if (!presence.online) {
    return { isIdle: true, reason: 'Game offline' }
  }
  if (now - lastLiveTranslateRequestAt < idleWindowMs) {
    return { isIdle: false, reason: 'Recent in-game live translate activity' }
  }
  return { isIdle: true, reason: 'Game running but idle' }
}

export type OptimizeDispatchKind = 'terms' | 'short-entities' | 'polish'

export function assertOptimizeMayDispatch(kind: OptimizeDispatchKind): { ok: true } | { ok: false; pausedReason: string } {
  if (kind === 'terms') return { ok: true }
  const idle = isSystemIdleForOptimization()
  if (!idle.isIdle) return { ok: false, pausedReason: idle.reason }
  return { ok: true }
}
