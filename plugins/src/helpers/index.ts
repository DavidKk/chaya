/**
 * Shared in-game plugin helpers. Prefer subpath imports; this barrel re-exports the stable public API.
 */

export { ensureLaunchEnvGlobals } from './env/ensure-launch-env'
export { pinApiBaseFromUrl, resolveApiBase, resolveApiBaseFallbacks, resolveLogUrl } from './env/env'
export { registerGameLinkEditHandlers } from './game/edit-link-bridge'
export { detectGameIdentity } from './game/game-identity'
export { startGameLink } from './game/game-link'
export { presenceSessionId, startGamePresence } from './game/presence'
export { startWindowSizePersist } from './game/window-size-persist'
export { chayaFetch, chayaPostJson } from './net/http'
export { ChayaLog, createLogger } from './net/logger'
export { tryNodeFsPath, tryNodeRequire } from './node/node-require'
export {
  adoptTemplateContent,
  appendAdoptedStyles,
  applyShadowStyles,
  clearElement,
  ensureCustomElementHost,
  getPluginErrors,
  mountUiTemplateShell,
  restorePluginErrors,
  setInnerHTML,
  showPluginError,
} from './ui'
