import { MAC_SHELL_SCRIPT } from '@/lib/game/mac-shell-command'
import { isRemoteScriptName, type RemoteScriptName } from '@/lib/remote-scripts/command'
import { INSTALL_APP_SCRIPT } from '@/lib/remote-scripts/install-app'

/** Server-only: script bodies stay out of client bundles. */
const SOURCES: Record<RemoteScriptName, string> = {
  'install.sh': INSTALL_APP_SCRIPT,
  'mac-shell.sh': MAC_SHELL_SCRIPT,
}

export function getRemoteScriptSource(name: string): string | null {
  return isRemoteScriptName(name) ? SOURCES[name] : null
}
