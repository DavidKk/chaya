/** Client-safe: names and the one-liner only, no script bodies. */
export const REMOTE_SCRIPT_NAMES = ['install.sh', 'mac-shell.sh'] as const
export type RemoteScriptName = (typeof REMOTE_SCRIPT_NAMES)[number]

export const REMOTE_SCRIPT_PREFIX = '/sh/'

export function isRemoteScriptName(name: string): name is RemoteScriptName {
  return (REMOTE_SCRIPT_NAMES as readonly string[]).includes(name)
}

export function remoteScriptUrl(origin: string, name: RemoteScriptName): string {
  return `${origin.replace(/\/$/, '')}${REMOTE_SCRIPT_PREFIX}${name}`
}

/** `bash -c` keeps stdin free for prompts, unlike `curl … | bash`. */
export function remoteScriptCommand(origin: string, name: RemoteScriptName): string {
  return `/bin/bash -c "$(curl -fsSL ${remoteScriptUrl(origin, name)})"`
}
