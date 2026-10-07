/**
 * Panel toggle + DevTools console hotkeys (Chrome-like defaults per OS).
 */
import { getOpenConsoleChord, getOpenPanelChord, isHotkeyDisabled, matchKeyChord, matchOpenPanelHotkey, OPEN_CONSOLE_HOTKEY_ID } from '@/components/game-edit/run-hotkeys'

import { createLogger, showPluginError } from '../../helpers'
import { getAutoTalkState } from '../runtime/auto-talk'
import { hideGameEditUi, isGameEditUiOpen } from '../ui/mount'

const log = createLogger('ChayaEdit')

function isPanelHotkey(ev: KeyboardEvent) {
  return matchOpenPanelHotkey(ev, getOpenPanelChord())
}

function isConsoleHotkey(ev: KeyboardEvent) {
  return !isHotkeyDisabled(OPEN_CONSOLE_HOTKEY_ID) && matchKeyChord(ev, getOpenConsoleChord())
}

function shouldIgnoreHotkeyInField(ev: KeyboardEvent) {
  const tag = (ev.target && (ev.target as Element).tagName) || ''
  const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ev.target as HTMLElement)?.isContentEditable
  return isGameEditUiOpen() && inField
}

function blockHotkeyEvent(ev: Event) {
  ev.preventDefault()
  ev.stopPropagation()
}

function openGameDevTools(): boolean {
  try {
    const nw = (globalThis as typeof globalThis & { nw?: { Window?: { get?: () => { showDevTools?: () => void } } } }).nw
    const win = nw?.Window?.get?.()
    if (win && typeof win.showDevTools === 'function') {
      win.showDevTools()
      return true
    }
  } catch (err) {
    log.warn('showDevTools 失败', err)
  }
  return false
}

function onHotkeyDown(ev: KeyboardEvent) {
  if ((ev as KeyboardEvent & { __chayaInputAssistGenerated?: boolean }).__chayaInputAssistGenerated) return
  if (isConsoleHotkey(ev)) {
    if (shouldIgnoreHotkeyInField(ev)) return
    blockHotkeyEvent(ev)
    return
  }
  if (!isPanelHotkey(ev)) return
  if (shouldIgnoreHotkeyInField(ev)) return
  blockHotkeyEvent(ev)
  if (!ev.repeat) getAutoTalkState().hotkeyArmed = true
}

function onHotkeyUp(ev: KeyboardEvent) {
  if ((ev as KeyboardEvent & { __chayaInputAssistGenerated?: boolean }).__chayaInputAssistGenerated) return
  if (isConsoleHotkey(ev)) {
    if (shouldIgnoreHotkeyInField(ev)) return
    blockHotkeyEvent(ev)
    if (ev.repeat) return
    setTimeout(() => {
      if (!openGameDevTools()) {
        showPluginError('无法打开控制台', '当前环境不支持 DevTools（需 NW.js / 壳窗口）。')
      }
    }, 0)
    return
  }

  const state = getAutoTalkState()
  if (!isPanelHotkey(ev)) return
  if (shouldIgnoreHotkeyInField(ev)) {
    state.hotkeyArmed = false
    return
  }
  blockHotkeyEvent(ev)
  if (!state.hotkeyArmed && ev.repeat) return
  state.hotkeyArmed = false
  const now = Date.now()
  if (now - state.lastToggleAt < 350) return
  state.lastToggleAt = now
  setTimeout(function () {
    try {
      if (!window.ChayaEdit || typeof window.ChayaEdit.toggle !== 'function') {
        showPluginError('无法打开插件控制台', 'ChayaEdit 未加载。请在网页控制台重新安装插件并重启游戏。')
        return
      }
      window.ChayaEdit.toggle()
    } catch (err) {
      log.fail('toggle 失败', err)
      showPluginError('无法打开插件控制台', err)
      try {
        hideGameEditUi()
      } catch {
        /* */
      }
    }
  }, 0)
}

export function startPanelHotkeys(): () => void {
  document.addEventListener('keydown', onHotkeyDown, true)
  document.addEventListener('keyup', onHotkeyUp, true)
  return () => {
    document.removeEventListener('keydown', onHotkeyDown, true)
    document.removeEventListener('keyup', onHotkeyUp, true)
  }
}
