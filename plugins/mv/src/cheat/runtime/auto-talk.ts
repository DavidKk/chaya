/**
 * Auto-talk: prefer Message.autoFlg when present; else hook Window_Message methods.
 */

import { gameMessage } from './game-globals'

type AutoTalkState = {
  fallback: boolean
  hooked: boolean
  lastToggleAt: number
  hotkeyArmed: boolean
}

const autoTalkState: AutoTalkState = { fallback: false, hooked: false, lastToggleAt: 0, hotkeyArmed: false }

export function getAutoTalkState() {
  return autoTalkState
}

function messageAutoApi() {
  const message = gameMessage()
  return message && typeof message.setAutoFlg === 'function' && typeof message.autoFlg === 'function' ? message : null
}

export function getAutoTalk(): boolean {
  const message = messageAutoApi()
  if (message) return !!message.autoFlg()
  return !!autoTalkState.fallback
}

export function setAutoTalk(on: boolean): boolean {
  const v = !!on
  const message = messageAutoApi()
  if (message) {
    message.setAutoFlg(v)
  }
  autoTalkState.fallback = v
  ensureAutoTalkFallback()
  return getAutoTalk()
}

type WindowMessageProto = typeof Window_Message.prototype & {
  __chayaAutoTalk?: boolean
  _geAutoWait?: number | null
  pause?: boolean
  isAnySubWindowActive?: () => boolean
  updateShowFast?: () => void
  updateWait?: () => boolean
  updateInput?: () => boolean
  isTriggered?: () => boolean
  terminateMessage?: () => void
  _textState?: unknown
  _showFast?: boolean
  _waitCount?: number
}

let pendingHookTimer: ReturnType<typeof setInterval> | null = null

function hasBlockingSubWindow(win: WindowMessageProto): boolean {
  if (typeof win.isAnySubWindowActive === 'function' && win.isAnySubWindowActive()) {
    return true
  }
  const msg = gameMessage()
  if (msg) {
    if (typeof msg.isChoice === 'function' && msg.isChoice()) return true
    if (typeof msg.isNumberInput === 'function' && msg.isNumberInput()) return true
    if (typeof msg.isItemChoice === 'function' && msg.isItemChoice()) return true
  }
  return false
}

export function ensureAutoTalkFallback() {
  if (typeof Window_Message === 'undefined' || !Window_Message.prototype) {
    if (!pendingHookTimer && typeof window !== 'undefined') {
      pendingHookTimer = setInterval(() => {
        if (typeof Window_Message !== 'undefined' && Window_Message.prototype) {
          if (pendingHookTimer) clearInterval(pendingHookTimer)
          pendingHookTimer = null
          ensureAutoTalkFallback()
        }
      }, 300)
    }
    return
  }

  if (pendingHookTimer) {
    clearInterval(pendingHookTimer)
    pendingHookTimer = null
  }

  const proto = Window_Message.prototype as WindowMessageProto
  if (proto.__chayaAutoTalk) {
    autoTalkState.hooked = true
    return
  }

  proto.__chayaAutoTalk = true
  autoTalkState.hooked = true

  // 1. Hook updateShowFast: immediately fast-forward typewriter printing when auto-talk is active
  const origUpdateShowFast = proto.updateShowFast
  proto.updateShowFast = function (this: WindowMessageProto) {
    if (getAutoTalk()) {
      this._showFast = true
    }
    if (typeof origUpdateShowFast === 'function') {
      origUpdateShowFast.apply(this, arguments as unknown as [])
    }
  }

  // 2. Hook updateWait: fast-forward inline pauses (\., \|) while dialogue is streaming
  const origUpdateWait = proto.updateWait
  proto.updateWait = function (this: WindowMessageProto) {
    if (getAutoTalk() && !this.pause) {
      if (typeof this._waitCount === 'number' && this._waitCount > 0) {
        this._waitCount = 0
        this._showFast = true
      }
    }
    return typeof origUpdateWait === 'function' ? origUpdateWait.apply(this, arguments as unknown as []) : false
  }

  // 3. Hook updateInput: advance dialogue once text finishes typing and is waiting for player confirm
  const origUpdateInput = proto.updateInput
  proto.updateInput = function (this: WindowMessageProto) {
    if (getAutoTalk() && this.pause) {
      if (!hasBlockingSubWindow(this)) {
        if (this._geAutoWait == null) this._geAutoWait = 12
        if (this._geAutoWait > 0) this._geAutoWait--
        if (this._geAutoWait <= 0) {
          this._geAutoWait = null
          this.pause = false
          if (!this._textState && typeof this.terminateMessage === 'function') {
            this.terminateMessage()
          }
          if (typeof Input !== 'undefined' && typeof Input.update === 'function') {
            Input.update()
          }
          return true
        }
      } else {
        this._geAutoWait = null
      }
    } else {
      this._geAutoWait = null
    }

    return typeof origUpdateInput === 'function' ? origUpdateInput.apply(this, arguments as unknown as []) : false
  }

  // 4. Hook isTriggered: fallback for other plugins or third-party engines calling isTriggered
  const origIsTriggered = proto.isTriggered
  proto.isTriggered = function (this: WindowMessageProto) {
    if (getAutoTalk() && this.pause && !hasBlockingSubWindow(this)) {
      if (this._geAutoWait == null || this._geAutoWait <= 0) {
        return true
      }
    }
    return typeof origIsTriggered === 'function' ? origIsTriggered.apply(this, arguments as unknown as []) : false
  }
}

// Ensure hooks are installed if Window_Message is already available at evaluation time
if (typeof window !== 'undefined') {
  ensureAutoTalkFallback()
}
