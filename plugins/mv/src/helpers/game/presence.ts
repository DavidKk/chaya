/**
 * In-game → Chaya: one-shot register at launch (with launchToken); online state via WebRTC.
 */

import { resolveApiBaseFallbacks } from '../env/env'
import { chayaPostJson } from '../net/http'
import { ChayaLog } from '../net/logger'
import { detectGameIdentity } from './game-identity'

const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now().toString(36)}`
let started = false
let identity = detectGameIdentity()

function launchToken(): string | undefined {
  try {
    const t = String((window as Window & { CHAYA_LAUNCH_TOKEN?: string }).CHAYA_LAUNCH_TOKEN || '').trim()
    return t || undefined
  } catch {
    return undefined
  }
}

/** One-shot register into the DB; no periodic heartbeat */
export async function registerWithToolkitOnce() {
  try {
    if (!identity) identity = detectGameIdentity()
    const platform =
      typeof navigator !== 'undefined' ? String(navigator.platform || navigator.userAgent || '') : typeof process !== 'undefined' ? String(process.platform || '') : null
    const body = {
      sessionId,
      platform,
      launchToken: launchToken(),
      ...(identity
        ? {
            contentRoot: identity.contentRoot,
            gameRoot: identity.gameRoot,
            name: identity.name,
          }
        : {}),
    }
    const bases = resolveApiBaseFallbacks()
    for (const base of bases) {
      try {
        const res = await chayaPostJson(`${base}/api/runtime/heartbeat`, body)
        if (!res.ok) continue
        ChayaLog.ok('ChayaRuntime', `已向服务报到 → ${base}`)
        return
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
}

/** @deprecated Name kept; now a one-shot presence ping */
export function startGamePresence() {
  if (started) return
  started = true
  setTimeout(() => {
    if (!identity) identity = detectGameIdentity()
  }, 800)
  void registerWithToolkitOnce()
}

export function stopGamePresence() {
  started = false
}

export function presenceSessionId() {
  return sessionId
}

export function presenceGameIdentity() {
  return identity
}
