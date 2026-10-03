import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'

import { clearElement, showPluginError } from '../../helpers'
import { GameEditApp } from './App'
import { ensureGameEditHost, type GameEditHost } from './host'
import overlayCss from './overlay.css?inline'

type UiState = {
  host: GameEditHost | null
  root: Root | null
  open: boolean
  didPauseGame: boolean
}

const state: UiState = {
  host: null,
  root: null,
  open: false,
  didPauseGame: false,
}

function pauseGame() {
  if (typeof SceneManager === 'undefined') return
  if (!SceneManager._stopped) {
    state.didPauseGame = true
    SceneManager.stop()
  }
}

function resumeGame() {
  if (!state.didPauseGame) return
  state.didPauseGame = false
  if (typeof Input !== 'undefined' && Input.clear) Input.clear()
  if (typeof SceneManager !== 'undefined' && SceneManager.resume) {
    SceneManager.resume()
  }
}

function render() {
  if (!state.root) return
  state.root.render(
    <LocaleProvider syncDocumentLang={false}>
      <GameEditApp open={state.open} onRequestClose={hideGameEditUi} />
    </LocaleProvider>
  )
}

/** Force-unmount React root + host (required before HMR) */
export function unmountGameEditUi() {
  const wasOpen = state.open
  state.open = false
  if (state.root) {
    try {
      state.root.unmount()
    } catch {
      /* */
    }
    state.root = null
  }
  if (state.host) {
    try {
      state.host.remove()
    } catch {
      /* */
    }
    state.host = null
  }
  if (wasOpen) resumeGame()
  return wasOpen
}

function ensureMounted() {
  if (state.host && state.root) return state.host
  // Empty host nodes may linger after HMR
  if (state.host && !state.root) {
    try {
      state.host.remove()
    } catch {
      /* */
    }
    state.host = null
  }
  const host = ensureGameEditHost(overlayCss)
  state.host = host
  // Clear the mount point to avoid stale fibers / dirty DOM
  clearElement(host.mount)
  state.root = createRoot(host.mount)
  return host
}

export function isGameEditUiOpen() {
  return state.open && !!state.host?.isOpen()
}

export function showGameEditUi() {
  if (!$gameParty) {
    showPluginError('无法打开插件控制台', '请先读档进入游戏地图后再试（$gameParty 不存在）')
    return false
  }
  try {
    pauseGame()
    const host = ensureMounted()
    state.open = true
    host.setOpen(true)
    render()
    return true
  } catch (err) {
    try {
      unmountGameEditUi()
    } catch {
      /* */
    }
    showPluginError('无法打开插件控制台', err)
    return false
  }
}

export function hideGameEditUi() {
  state.open = false
  if (state.host) {
    const ae = document.activeElement
    if (ae && state.host.containsFocus(ae) && typeof (ae as HTMLElement).blur === 'function') {
      try {
        ;(ae as HTMLElement).blur()
      } catch {
        /* */
      }
    }
    state.host.setOpen(false)
    // 只隐藏：保留 Shadow / CSS / React root，下次唤出免冷挂载
    render()
  }
  resumeGame()
}

export function toggleGameEditUi() {
  if (isGameEditUiOpen()) hideGameEditUi()
  else showGameEditUi()
}

/** After HMR: clean mount points and reopen if needed */
export function remountGameEditUi(reopen: boolean) {
  unmountGameEditUi()
  if (reopen && $gameParty) showGameEditUi()
}
