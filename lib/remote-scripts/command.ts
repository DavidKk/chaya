import type { Locale } from '@/lib/i18n/locales'

/** Client-safe: names and the one-liner only, no script bodies. */
export const REMOTE_SCRIPT_NAMES = ['install.sh', 'mac-shell.sh'] as const
export type RemoteScriptName = (typeof REMOTE_SCRIPT_NAMES)[number]

export const REMOTE_SCRIPT_PREFIX = '/sh/'

/** Replaced with the serving origin so scripts can fetch companion files (e.g. language packs) from the same server. */
export const REMOTE_SCRIPT_ORIGIN_PLACEHOLDER = '__CHAYA_ORIGIN__'

export function isRemoteScriptName(name: string): name is RemoteScriptName {
  return (REMOTE_SCRIPT_NAMES as readonly string[]).includes(name)
}

export function remoteScriptUrl(origin: string, name: RemoteScriptName): string {
  return `${origin.replace(/\/$/, '')}${REMOTE_SCRIPT_PREFIX}${name}`
}

/** Scripts that print localized messages, picked via `CHAYA_LANG`. */
const LOCALIZED_SCRIPTS: ReadonlySet<RemoteScriptName> = new Set(['install.sh', 'mac-shell.sh'])

/** `mac-shell.sh` installs by default; `uninstall` removes the Chaya-written shell. */
export type RemoteScriptAction = 'uninstall'

/** `bash -c` keeps stdin free for prompts, unlike `curl … | bash`. */
export function remoteScriptCommand(origin: string, name: RemoteScriptName, locale?: Locale, action?: RemoteScriptAction): string {
  const lang = locale && LOCALIZED_SCRIPTS.has(name) ? `CHAYA_LANG=${locale} ` : ''
  const act = action ? `CHAYA_ACTION=${action} ` : ''
  return `${lang}${act}/bin/bash -c "$(curl -fsSL ${remoteScriptUrl(origin, name)})"`
}
