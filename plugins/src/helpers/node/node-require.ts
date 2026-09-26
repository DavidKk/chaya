/**
 * NW / Electron in-game: safely get Node `fs` + `path` (returns null in the browser).
 */

export type NodeFsPath = { fs: typeof import('fs'); path: typeof import('path') }

export function tryNodeRequire(): NodeRequire | null {
  try {
    const req = (globalThis as { require?: NodeRequire }).require
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
