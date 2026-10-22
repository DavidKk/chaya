/**
 * Chaya plugin runtime entry
 * logger/http → one-shot presence → WebRTC / web link
 */

import {
  chayaFetch,
  ChayaLog,
  chayaPostJson,
  presenceSessionId,
  resolveApiBase,
  resolveLogUrl,
  startCrashLog,
  startGameLink,
  startGamePresence,
  startWindowSizePersist,
} from './helpers'

declare global {
  interface Window {
    ChayaLog: typeof ChayaLog
    Chaya: {
      log: typeof ChayaLog
      fetch: typeof chayaFetch
      postJson: typeof chayaPostJson
      apiBase: () => string
      logUrl: () => string
      sessionId: () => string
    }
  }
}

window.ChayaLog = ChayaLog
window.Chaya = {
  log: ChayaLog,
  fetch: chayaFetch,
  postJson: chayaPostJson,
  apiBase: resolveApiBase,
  logUrl: resolveLogUrl,
  sessionId: presenceSessionId,
}

startCrashLog()
startGamePresence()
startGameLink()
try {
  startWindowSizePersist()
} catch {
  /* Window-size persist failure must not block the link */
}
ChayaLog.ok('ChayaRuntime', `插件运行时已就绪 → ${resolveApiBase()}`)
