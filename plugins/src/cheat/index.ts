/**
 * ChayaEdit — entry: HMR dispose, wire API / hotkeys / disk watch.
 */
import { startGameAgentHotkeys } from '../agent-ui/hotkeys'
import { hideGameAgentUi, unmountGameAgentUi } from '../agent-ui/mount'
import { startPluginGameAgentSync } from '../agent-ui/request'
import { createLogger, registerGameLinkEditHandlers, restorePluginErrors, showPluginError } from '../helpers'
import { installConsoleApi } from './console/console-api'
import { startPanelHotkeys } from './console/panel-hotkeys'
import { Cheats } from './runtime/cheats'
import { disposeMapHistory, installMapHistory } from './session/map-history'
import { startGameEditDiskWatcher } from './session/persist'
import { handleRemoteEditMessage, stopRemoteEditBridge } from './session/remote-bridge'
import { captureGameEditView } from './ui/App'
import { isGameEditUiOpen, remountGameEditUi, showGameEditUi, unmountGameEditUi } from './ui/mount'

const log = createLogger('ChayaEdit')

/** Previous IIFE dispose (tear down React root + hotkeys on HMR) */
const reopenAfterHot = (() => {
  try {
    const prev = (window as Window & { __chayaGameEditDispose?: { dispose: () => boolean } }).__chayaGameEditDispose
    if (prev) captureGameEditView()
    return prev?.dispose?.() ?? false
  } catch {
    return false
  }
})()

installConsoleApi()
installMapHistory()
const unregisterLink = registerGameLinkEditHandlers({
  onMessage: handleRemoteEditMessage,
  onStop: stopRemoteEditBridge,
})

const stopHotkeys = startPanelHotkeys()
const stopAgentHotkeys = startGameAgentHotkeys()
const stopAgentSettingsSync = startPluginGameAgentSync()
const openAgentSettings = () => {
  const host = window as Window & { __chayaGameEditView?: Record<string, unknown> }
  host.__chayaGameEditView = { ...(host.__chayaGameEditView || {}), tab: 'settings' }
  hideGameAgentUi()
  showGameEditUi()
  window.dispatchEvent(new CustomEvent('chaya:game-settings-opened'))
}
window.addEventListener('chaya:game-settings-open', openAgentSettings)

function disposeGameEditRuntime(): boolean {
  const wasOpen = isGameEditUiOpen()
  try {
    unmountGameEditUi()
  } catch {
    /* */
  }
  try {
    Cheats.disposeHooks()
  } catch {
    /* */
  }
  stopHotkeys()
  stopAgentHotkeys()
  stopAgentSettingsSync()
  window.removeEventListener('chaya:game-settings-open', openAgentSettings)
  unmountGameAgentUi()
  unregisterLink()
  stopRemoteEditBridge()
  disposeMapHistory()
  return wasOpen
}

try {
  startGameEditDiskWatcher()
} catch {
  /* No fs / not in a content root: ignore */
}

;(window as Window & { __chayaGameEditDispose?: { dispose: () => boolean } }).__chayaGameEditDispose = {
  dispose: disposeGameEditRuntime,
}

if (reopenAfterHot) {
  setTimeout(() => {
    try {
      remountGameEditUi(true)
    } catch (err) {
      log.fail('热替换重挂载失败', err)
      showPluginError('插件控制台热替换重挂载失败', err)
    }
  }, 0)
}

log.info('已就绪：按反引号打开 React 面板，或 ChayaEdit.ui()')
restorePluginErrors()
