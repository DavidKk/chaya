/**
 * Detect in-game content root / display name for proactive heartbeat registration with Chaya.
 */

import { tryNodeRequire } from '../node/node-require'

type NodePath = typeof import('path')
type NodeFs = typeof import('fs')

export type GameIdentity = {
  contentRoot: string
  gameRoot: string
  name: string
}

function looksLikeContent(fs: NodeFs, path: NodePath, dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'data')) && fs.existsSync(path.join(dir, 'js'))
  } catch {
    return false
  }
}

function resolveContentFrom(fs: NodeFs, path: NodePath, start: string): string | null {
  let cur = path.resolve(start)
  for (let i = 0; i < 8; i++) {
    if (looksLikeContent(fs, path, cur)) return cur
    const www = path.join(cur, 'www')
    if (looksLikeContent(fs, path, www)) return www
    const appNw = path.join(cur, 'package.nw')
    if (looksLikeContent(fs, path, appNw)) return appNw
    const nested = path.join(cur, 'Contents', 'Resources', 'app.nw')
    if (looksLikeContent(fs, path, nested)) return nested
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

function readPackageTitle(fs: NodeFs, path: NodePath, contentRoot: string): string | null {
  for (const file of [path.join(contentRoot, 'package.json'), path.join(path.dirname(contentRoot), 'package.json')]) {
    try {
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        name?: string
        window?: { title?: string }
      }
      const title = raw.window?.title?.trim() || raw.name?.trim()
      if (title) return title
    } catch {
      /* ignore */
    }
  }
  return null
}

function systemGameTitle(): string | null {
  try {
    const sys = (globalThis as { $dataSystem?: { gameTitle?: string } }).$dataSystem
    const t = sys?.gameTitle?.trim()
    return t || null
  } catch {
    return null
  }
}

function collectStartCandidates(path: NodePath): string[] {
  const out: string[] = []
  try {
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      out.push(process.cwd())
    }
  } catch {
    /* ignore */
  }
  try {
    const nw = (globalThis as { nw?: { App?: { startPath?: string } } }).nw
    if (nw?.App?.startPath) out.push(String(nw.App.startPath))
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
      for (const arg of process.argv) {
        if (arg && !arg.startsWith('-') && (arg.includes('/') || arg.includes('\\'))) out.push(arg)
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof location !== 'undefined' && location.protocol === 'file:' && location.pathname) {
      let p = decodeURIComponent(location.pathname)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      out.push(path.dirname(p))
    }
  } catch {
    /* ignore */
  }
  return out
}

/** Probe current content root; null on failure (heartbeat can still report online-only) */
export function detectGameIdentity(): GameIdentity | null {
  const req = tryNodeRequire()
  if (!req) return null
  let path: NodePath
  let fs: NodeFs
  try {
    path = req('path') as NodePath
    fs = req('fs') as NodeFs
  } catch {
    return null
  }

  for (const start of collectStartCandidates(path)) {
    const contentRoot = resolveContentFrom(fs, path, start)
    if (!contentRoot) continue
    const base = path.basename(contentRoot).toLowerCase()
    const gameRoot = base === 'www' || base === 'app.nw' || base === 'package.nw' ? path.dirname(contentRoot) : contentRoot
    const name = systemGameTitle() || readPackageTitle(fs, path, contentRoot) || path.basename(gameRoot).replace(/\.app$/i, '') || '未命名游戏'
    return { contentRoot, gameRoot, name }
  }
  return null
}
