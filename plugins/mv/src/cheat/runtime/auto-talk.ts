/**
 * Auto-talk: prefer Message.autoFlg when present; else hook Window_Message.isTriggered.
 */

import { gameMessage } from './game-globals'

const autoTalkState = { fallback: false, hooked: false, lastToggleAt: 0, hotkeyArmed: false }

export function getAutoTalkState() {
  return autoTalkState
}

function messageAutoApi() {
  const message = gameMessage()
  return message && typeof message.setAutoFlg === 'function' && typeof message.autoFlg === 'function' ? message : null
}

export function getAutoTalk() {
  const message = messageAutoApi()
  if (message) return !!message.autoFlg()
  return !!autoTalkState.fallback
}

export function setAutoTalk(on: boolean) {
  const v = !!on
  const message = messageAutoApi()
  if (message) {
    message.setAutoFlg(v)
  } else {
    autoTalkState.fallback = v
    ensureAutoTalkFallback()
  }
  return getAutoTalk()
}

export function ensureAutoTalkFallback() {
  const proto = Window_Message.prototype as typeof Window_Message.prototype & {
    __chayaAutoTalk?: boolean
    _geAutoWait?: number | null
    pause?: boolean
    isAnySubWindowActive?: () => boolean
  }
  if (proto.__chayaAutoTalk) {
    autoTalkState.hooked = true
    return
  }
  autoTalkState.hooked = true
  proto.__chayaAutoTalk = true
  const _isTriggered = Window_Message.prototype.isTriggered
  Window_Message.prototype.isTriggered = function (this: typeof proto) {
    if (autoTalkState.fallback && this.pause && !this.isAnySubWindowActive?.()) {
      if (this._geAutoWait == null) this._geAutoWait = 40
      if (this._geAutoWait > 0) this._geAutoWait--
      if (this._geAutoWait <= 0) {
        this._geAutoWait = 40
        return true
      }
    } else {
      this._geAutoWait = null
    }
    return _isTriggered.apply(this, arguments as unknown as [])
  }
}
