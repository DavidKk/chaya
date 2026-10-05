import { PLUGIN_LOADER_NAME } from '@/constants/brand'

import { TRACKED_PLUGINS } from './types'

/** Files the "plugins up to date" check compares: what ChayaLoader loads from disk first. */
export const DIGEST_PLUGIN_NAMES: readonly string[] = [PLUGIN_LOADER_NAME, ...TRACKED_PLUGINS]

/** Content fingerprint shared by the server and the browser (no WebCrypto: LAN http pages lack `crypto.subtle`). */
export function pluginDigest(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** Unknown latest digests → not outdated; a missing or different game file → outdated. */
export function pluginsOutdated(game: Readonly<Record<string, string | null>>, latest: Readonly<Record<string, string>> | null): boolean {
  if (!latest) return false
  return DIGEST_PLUGIN_NAMES.some((name) => latest[name] && game[name] !== latest[name])
}
