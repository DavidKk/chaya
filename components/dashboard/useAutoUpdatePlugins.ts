import { useCallback, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'

export const AUTO_UPDATE_PLUGINS_KEY = 'chaya.autoUpdatePlugins'

function readPref(): boolean {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_PLUGINS_KEY) !== '0'
  } catch {
    return true
  }
}

type Options = {
  /** Host can write the game folder without a click; otherwise the switch is fixed to manual */
  supported: boolean
  /** Installed plugins differ from the current build */
  outdated: boolean
  /** Identifies the game; one attempt per game per page while it stays outdated */
  gameKey: string
  busy: boolean
  gameOnline: boolean
  /** Resolves whether the plugins were written; `null` = skipped (e.g. folder not authorized yet), retried later */
  update: () => Promise<boolean | null>
}

/** Default on; stored per browser. Failures are not retried until the switch is toggled or the page reloads. */
export function useAutoUpdatePlugins({ supported, outdated, gameKey, busy, gameOnline, update }: Options) {
  const t = useT()
  const notify = useNotification()
  /** `null` until read from storage, so a stored "off" never fires one update on mount */
  const [pref, setPref] = useState<boolean | null>(null)
  const attempted = useRef(new Set<string>())
  const latest = useRef({ update, gameOnline })
  latest.current = { update, gameOnline }

  useEffect(() => setPref(readPref()), [])

  const setEnabled = useCallback((next: boolean) => {
    setPref(next)
    attempted.current.clear()
    try {
      window.localStorage.setItem(AUTO_UPDATE_PLUGINS_KEY, next ? '1' : '0')
    } catch {}
  }, [])

  const enabled = supported && pref === true

  useEffect(() => {
    if (!gameKey) return
    if (!outdated) {
      attempted.current.delete(gameKey)
      return
    }
    if (!enabled || busy || attempted.current.has(gameKey)) return
    attempted.current.add(gameKey)
    const online = latest.current.gameOnline
    void latest.current.update().then((ok) => {
      if (ok === null) attempted.current.delete(gameKey)
      if (ok) notify.success(t(online ? 'notify.pluginsAutoUpdatedRestart' : 'notify.pluginsAutoUpdated'))
    })
  }, [enabled, outdated, gameKey, busy, notify, t])

  return { enabled: supported && pref !== false, supported, onChange: setEnabled }
}
