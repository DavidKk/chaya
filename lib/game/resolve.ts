import fs from 'node:fs'
import path from 'node:path'

import { ROOT_PATH } from '@/constants/paths'

import { findEnclosingLinuxBinary, findEnclosingWinExe, isWin32, validShellExists } from './shell-layout'
import { resolveToolkitShellAppPath } from './toolkit-data'
import { LEGACY_PROJECT_SHELL_NAMES, type ResolvedGame, type ResolveError, SHELL_APP_NAME } from './types'
import { detectUnsupportedEngine, type UnsupportedEngine, unsupportedEngineMessage } from './unsupported-engine'

const RGSS_ASSET_DIRS = new Set(['data', 'system', 'graphics', 'audio', 'fonts'])

function readNames(dir: string): string[] {
  try {
    return fs.readdirSync(/* turbopackIgnore: true */ dir)
  } catch {
    return []
  }
}

function listingEngine(dir: string): UnsupportedEngine | null {
  const root = readNames(dir)
  const sub = (name: string) => {
    const hit = root.find((entry) => entry.toLowerCase() === name)
    return hit ? readNames(path.join(dir, hit)) : []
  }
  return detectUnsupportedEngine({ root, data: sub('data'), system: sub('system') })
}

/** Engine name when the selected game is not MV / MZ (legacy RPG Maker, Unity) */
function detectUnsupportedEngineAt(selected: string): UnsupportedEngine | null {
  let dir = selected
  try {
    if (!fs.statSync(/* turbopackIgnore: true */ selected).isDirectory()) dir = path.dirname(selected)
  } catch {
    return null
  }
  if (dir.toLowerCase().endsWith('.app')) return detectUnsupportedEngine({ root: readNames(path.join(dir, 'Contents/Frameworks')) })
  const engine = listingEngine(dir)
  if (engine || !RGSS_ASSET_DIRS.has(path.basename(dir).toLowerCase())) return engine
  return listingEngine(path.dirname(dir))
}

function unsupportedOr(selected: string, error: string): ResolveError {
  const engine = detectUnsupportedEngineAt(selected)
  return engine ? { ok: false, error: unsupportedEngineMessage(engine), engine } : { ok: false, error }
}

export function looksLikeContent(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'data')) && fs.existsSync(path.join(dir, 'js'))
  } catch {
    return false
  }
}

/**
 * 规范化用户粘贴的路径：去引号、取首个真实存在的绝对路径。
 * 常见误操作：把同一路径粘贴两次 → `/a/b /a/b`。
 */
export function normalizeGamePathInput(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
  if (!s) return ''
  if (fs.existsSync(s)) return path.resolve(s)

  // POSIX：空格分隔的多段绝对路径，取第一个存在的
  if (!isWin32() && /\s+\//.test(s)) {
    for (const part of s.split(/\s+/).filter(Boolean)) {
      if (part.startsWith('/') && fs.existsSync(part)) return path.resolve(part)
    }
  }

  // Windows：`C:\foo C:\foo` 或 `C:/foo C:/foo`
  if (isWin32() && /\s+[A-Za-z]:[\\/]/.test(s)) {
    for (const part of s.split(/\s+/).filter(Boolean)) {
      if (/^[A-Za-z]:[\\/]/.test(part) && fs.existsSync(part)) return path.resolve(part)
    }
  }

  return s
}

/** 向上查找包含 Contents 的 .app 包（macOS） */
export function findEnclosingAppBundle(dir: string): string | null {
  let cur = path.resolve(dir)
  for (;;) {
    if (cur.toLowerCase().endsWith('.app') && fs.existsSync(path.join(cur, 'Contents'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function isInsideAppContents(contentRoot: string, bundle: string): boolean {
  const contents = path.join(bundle, 'Contents') + path.sep
  return path.resolve(contentRoot).startsWith(contents)
}

/**
 * 解析用户选中的路径 → 内容根 + 游戏项目根
 * 纯路径约定，不读 Chaya 配置文件。
 *
 * 选择器只负责给出路径（单次目录选择，见 docs/technical/game-path-picker.md）；
 * 本函数负责识别形态，勿把「先问类型」加回 picker。
 *
 * - 独立发布根 / www：壳用工具共用 `data/shell/…`（不按作复制）
 * - 已打包：macOS `.app`，或 Windows/Linux 旁挂 `Game.exe` / `nw`
 */
export function resolveGame(input: string, toolkitRoot = ROOT_PATH): ResolvedGame | ResolveError {
  if (!input || !String(input).trim()) {
    return { ok: false, error: '未选择游戏目录' }
  }
  const normalized = normalizeGamePathInput(input)
  const p = path.resolve(/* turbopackIgnore: true */ normalized)
  if (!fs.existsSync(/* turbopackIgnore: true */ p)) {
    const raw = String(input).trim()
    if (raw !== normalized && /\s+\//.test(raw)) {
      return { ok: false, error: `路径不存在（检测到可能粘贴了两次路径）: ${raw}` }
    }
    return { ok: false, error: `路径不存在: ${p}` }
  }

  const finish = (contentRoot: string, selected: string, kind: ResolvedGame['kind']): ResolvedGame => {
    const contentAbs = path.resolve(contentRoot)
    const bundle = findEnclosingAppBundle(contentAbs)

    if (bundle && isInsideAppContents(contentAbs, bundle)) {
      return {
        ok: true,
        selected,
        contentRoot: contentAbs,
        projectRoot: bundle,
        kind: 'app.nw',
        shellApp: bundle,
        hasShell: true,
        hasWwwLayout: true,
        bundled: true,
      }
    }

    if (isWin32()) {
      const winExe = findEnclosingWinExe(contentAbs)
      if (winExe) {
        const projectRoot = path.dirname(winExe)
        // 内容在 exe 同树下：视为已打包，直接用该 exe 启动
        if (contentAbs === projectRoot || contentAbs.startsWith(projectRoot + path.sep)) {
          return {
            ok: true,
            selected,
            contentRoot: contentAbs,
            projectRoot,
            kind: kind === 'www' ? 'www' : 'app.nw',
            shellApp: winExe,
            hasShell: true,
            hasWwwLayout: true,
            bundled: true,
          }
        }
      }
    } else if (process.platform === 'linux') {
      const linuxBin = findEnclosingLinuxBinary(contentAbs)
      if (linuxBin) {
        const projectRoot = path.dirname(linuxBin)
        if (contentAbs === projectRoot || contentAbs.startsWith(projectRoot + path.sep)) {
          return {
            ok: true,
            selected,
            contentRoot: contentAbs,
            projectRoot,
            kind: kind === 'www' ? 'www' : 'app.nw',
            shellApp: linuxBin,
            hasShell: true,
            hasWwwLayout: true,
            bundled: true,
          }
        }
      }
    }

    const base = path.basename(contentAbs).toLowerCase()
    const projectRoot = base === 'www' || base === 'app.nw' || base === 'package.nw' ? path.dirname(contentAbs) : contentAbs
    const shellApp = resolveToolkitShellAppPath(toolkitRoot)
    const legacyCandidates = [SHELL_APP_NAME, ...LEGACY_PROJECT_SHELL_NAMES].map((name) => path.join(projectRoot, name))
    const legacyHit = legacyCandidates.find((p) => validShellExists(p))
    const hasShared = fs.existsSync(shellApp)
    return {
      ok: true,
      selected,
      contentRoot: contentAbs,
      projectRoot,
      kind,
      shellApp: hasShared ? shellApp : legacyHit || shellApp,
      hasShell: hasShared || Boolean(legacyHit),
      hasWwwLayout: looksLikeContent(contentAbs),
      bundled: false,
    }
  }

  // Windows / Linux：直接选中可执行文件 → 旁挂 www / package.nw
  const baseName = path.basename(p)
  const looksLikeGameBinary = p.toLowerCase().endsWith('.exe') || (!fs.statSync(/* turbopackIgnore: true */ p).isDirectory() && /^(game|nw|nwjs)(\.exe)?$/i.test(baseName))
  if (looksLikeGameBinary && fs.statSync(/* turbopackIgnore: true */ p).isFile()) {
    const dir = path.dirname(p)
    for (const c of [path.join(dir, 'www'), path.join(dir, 'package.nw'), path.join(dir, 'app.nw'), dir]) {
      if (looksLikeContent(c)) return finish(c, p, path.basename(c).toLowerCase() === 'www' ? 'www' : 'app.nw')
    }
    return unsupportedOr(p, '在可执行文件旁找不到内容根（需 www/ 或含 index.html + data/ + js/）')
  }

  function resolvePackagedApp(appPath: string, selected: string): ResolvedGame | ResolveError {
    const candidates = [path.join(appPath, 'Contents/Resources/app.nw'), path.join(appPath, 'Contents/Resources/app')]
    for (const c of candidates) {
      if (looksLikeContent(c)) return finish(c, selected, 'app.nw')
    }
    return unsupportedOr(appPath, '在 .app 内找不到 app.nw 内容根（需 index.html + data/ + js/）')
  }

  if (p.toLowerCase().endsWith('.app')) {
    return resolvePackagedApp(p, p)
  }

  if (looksLikeContent(p)) {
    const kind = path.basename(p).toLowerCase() === 'www' ? 'www' : 'content-root'
    return finish(p, p, kind)
  }

  const www = path.join(p, 'www')
  if (looksLikeContent(www)) return finish(www, p, 'www')

  const appNw = path.join(p, 'Contents/Resources/app.nw')
  if (looksLikeContent(appNw)) return finish(appNw, p, 'app.nw')

  const packageNw = path.join(p, 'package.nw')
  if (looksLikeContent(packageNw)) return finish(packageNw, p, 'app.nw')

  /* 选中解压目录（如 nwjs-sdk-…/）时，尝试其中唯一带内容的 .app */
  try {
    if (fs.statSync(/* turbopackIgnore: true */ p).isDirectory()) {
      const appNames = fs.readdirSync(/* turbopackIgnore: true */ p).filter((n) => n.toLowerCase().endsWith('.app'))
      const hits: string[] = []
      for (const name of appNames) {
        const appPath = path.join(p, name)
        const inner = [path.join(appPath, 'Contents/Resources/app.nw'), path.join(appPath, 'Contents/Resources/app')]
        if (inner.some((c) => looksLikeContent(c))) hits.push(appPath)
      }
      if (hits.length === 1) return resolvePackagedApp(hits[0], p)
      if (hits.length > 1) {
        return {
          ok: false,
          error: `目录内有多个可用 .app，请直接选择其中一个：${hits.map((h) => path.basename(h)).join(', ')}`,
        }
      }
    }
  } catch {
    /* ignore */
  }

  return unsupportedOr(
    p,
    isWin32()
      ? '未识别为 RPG Maker 内容（需要 index.html + data/ + js/、www/，或旁挂 Game.exe 的发布目录）'
      : process.platform === 'linux'
        ? '未识别为 RPG Maker 内容（需要 index.html + data/ + js/、www/，或旁挂 Game/nw 的发布目录）'
        : '未识别为 RPG Maker 内容（需要 index.html + data/ + js/，子目录 www/，或已打包的 .app；macOS 请用选择器直接点选 .app）'
  )
}
