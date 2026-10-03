import { MAC_SHELL_SCRIPT } from '@/lib/game/mac-shell-command'
import { MAC_SHELL_MESSAGES } from '@/lib/game/mac-shell-messages'
import { isRemoteScriptName, REMOTE_SCRIPT_ORIGIN_PLACEHOLDER, type RemoteScriptName } from '@/lib/remote-scripts/command'
import { scriptI18nLocale, type ScriptMessages } from '@/lib/remote-scripts/i18n'
import { INSTALL_APP_MESSAGES, INSTALL_APP_SCRIPT } from '@/lib/remote-scripts/install-app'

/** Server-only: script bodies stay out of client bundles. */
const SOURCES: Record<RemoteScriptName, string> = {
  'install.sh': INSTALL_APP_SCRIPT,
  'mac-shell.sh': MAC_SHELL_SCRIPT,
}

/** Lands inside single-quoted Bash; Host is client-controlled. */
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/

/** Without `origin` the placeholder stays (the viewer fills it in with the page origin). */
export function getRemoteScriptSource(name: string, origin?: string): string | null {
  if (!isRemoteScriptName(name)) return null
  const safe = origin?.replace(/\/$/, '')
  return safe && SAFE_ORIGIN.test(safe) ? SOURCES[name].replaceAll(REMOTE_SCRIPT_ORIGIN_PLACEHOLDER, safe) : SOURCES[name]
}

/** Language packs by script name (`/sh/i18n/<script>.<locale>.json`). */
export const SCRIPT_MESSAGES: Record<string, ScriptMessages> = {
  install: INSTALL_APP_MESSAGES,
  'mac-shell': MAC_SHELL_MESSAGES,
}

export function getScriptI18nPack(file: string): Record<string, string> | null {
  for (const [script, messages] of Object.entries(SCRIPT_MESSAGES)) {
    const locale = scriptI18nLocale(script, file)
    if (locale) return messages[locale]
  }
  return null
}
