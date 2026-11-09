/**
 * NW / Electron in-game: safely get Node `fs` + `path` (returns null in the browser).
 */

import { installRequireProtection } from '@/lib/runtime/require-protection'

// Guard Node require before any AMD loader (e.g. Monaco Editor) runs in the game window
installRequireProtection()

export type NodeFsPath = { fs: typeof import('fs'); path: typeof import('path') }

export function tryNodeRequire(): NodeRequire | null {
  try {
    const glob = globalThis as { nodeRequire?: NodeRequire; require?: NodeRequire }
    const req = glob.nodeRequire || glob.require
    return typeof req === 'function' ? req : null
  } catch {
    return null
  }
}

export function tryNodeFsPath(): NodeFsPath | null {
  const req = tryNodeRequire()
  if (!req) return null
  try {
    return { fs: req('fs') as typeof import('fs'), path: req('path') as typeof import('path') }
  } catch {
    return null
  }
}
