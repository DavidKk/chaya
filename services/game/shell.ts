import fs from 'node:fs'
import path from 'node:path'

import { LEGACY_SHELL_APP_NAMES, LEGACY_SHELL_WIN_DIR_NAMES } from '@/constants/brand'
import { DATA_DIR_NAME, SHELL_DIR_NAME } from '@/constants/path-names'
import { LEGACY_SHELL_AT_DATA_PATHS, LEGACY_SHELL_IN_SHELL_PATHS } from '@/constants/paths'
import { isWin32, looksLikeNwShellSource, resolveShellSourceRoot, toolkitShellFolderName } from '@/lib/game/shell-layout'
import { toolkitShellAppPath } from '@/lib/game/toolkit-data'

export type ShellInstallResult = {
  shellApp: string
  contentLink: string
  created: boolean
  relinked: boolean
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function looksLikeMacNwApp(appPath: string): boolean {
  const macOs = path.join(appPath, 'Contents/MacOS')
  if (!fs.existsSync(macOs)) return false
  try {
    const bins = fs.readdirSync(macOs)
    return bins.some((b) => /nw/i.test(b) || b === 'nwjs' || b === 'node-webkit')
  } catch {
    return false
  }
}

/** 壳源不应直接等于正在用的内容根所在包（避免把游戏拷进壳） */
export function validateShellSource(shellSource: string, contentRoot: string): string | null {
  const src = path.resolve(shellSource)
  if (!fs.existsSync(src)) return '壳源路径不存在'

  if (isWin32()) {
    if (!looksLikeNwShellSource(src)) {
      return '壳源需为 nw.exe，或含 nw.exe 的 NW.js 目录'
    }
    let root: string
    try {
      root = resolveShellSourceRoot(src)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    if (contentRoot === root || contentRoot.startsWith(root + path.sep)) {
      return '内容根位于壳源内部，请换一份干净 NW.js，或先把游戏挪到独立 www/'
    }
    return null
  }

  if (!src.endsWith('.app') || !fs.existsSync(src)) {
    return '壳源路径需指向已存在的 .app（如官方 nwjs.app，安装后为统一壳名）'
  }
  if (!looksLikeMacNwApp(src)) {
    return '壳源看起来不是 NW.js .app'
  }
  const srcAppNw = path.join(src, 'Contents/Resources/app.nw')
  if (path.resolve(contentRoot) === path.resolve(srcAppNw)) {
    return '壳源正是当前内容根所在的 .app，请换一份干净 NW.js，或先把游戏挪到独立 www/'
  }
  if (contentRoot.startsWith(src + path.sep)) {
    return '内容根位于壳源内部，不能用该 .app 做壳源'
  }
  return null
}

function linkContent(appNwLink: string, contentRoot: string): void {
  const type = isWin32() ? 'junction' : undefined
  fs.symlinkSync(contentRoot, appNwLink, type)
}

/**
 * 把干净 NW.js 装到工具 `data/shell/…`（全游戏共用一份）。
 * - macOS：拷 .app，并把 app.nw 链到内容根
 * - Windows：拷 nw 目录；启动时传内容根参数（不强制 junction）
 */
export function installShell(opts: {
  shellSource: string
  contentRoot: string
  /** @deprecated 旁挂时代参数；现忽略，壳固定在 data/shell/ */
  projectRoot?: string
  toolkitRoot?: string
  /** 已有共用壳时先删除再拷贝（用于升级到新版 NW.js） */
  force?: boolean
}): ShellInstallResult {
  const contentRoot = path.resolve(opts.contentRoot)
  const toolkitRoot = opts.toolkitRoot ? path.resolve(opts.toolkitRoot) : undefined

  if (!isWin32() && contentRoot.includes(`${path.sep}Contents${path.sep}`)) {
    const errBundle = contentRoot.match(/^(.*\.app)(?:\/|$)/i)?.[1]
    if (errBundle && contentRoot.startsWith(path.join(errBundle, 'Contents'))) {
      throw new Error('当前已是 NW.js 打包应用，壳已就绪。无需再装壳，可直接处理插件与翻译。')
    }
  }

  const err = validateShellSource(opts.shellSource, contentRoot)
  if (err) throw new Error(err)

  if (!fs.existsSync(contentRoot) || !fs.statSync(contentRoot).isDirectory()) {
    throw new Error(`内容根不存在: ${contentRoot}`)
  }

  const shellSourceRoot = resolveShellSourceRoot(opts.shellSource)
  const shellApp = toolkitRoot ? toolkitShellAppPath(toolkitRoot) : toolkitShellAppPath()
  const dataDir = path.dirname(shellApp)

  if (contentRoot === shellApp || contentRoot.startsWith(shellApp + path.sep)) {
    throw new Error('内容根不能位于共用壳内部')
  }

  let created = false
  if (opts.force && (fs.existsSync(shellApp) || isSymlink(shellApp))) {
    fs.rmSync(shellApp, { recursive: true, force: true })
  }
  if (!fs.existsSync(shellApp)) {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.cpSync(shellSourceRoot, shellApp, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(shellSourceRoot, src)
        if (!rel || rel === '.') return true
        // 不把游戏内容拷进共用壳
        if (rel === 'package.nw' || rel === 'www' || rel === 'app.nw') return false
        if (rel.startsWith(`package.nw${path.sep}`) || rel.startsWith(`www${path.sep}`) || rel.startsWith(`app.nw${path.sep}`)) {
          return false
        }
        if (rel === path.join('Contents', 'Resources', 'app.nw')) return false
        if (rel.startsWith(path.join('Contents', 'Resources', 'app.nw') + path.sep)) return false
        return true
      },
    })
    created = true
  }

  if (isWin32()) {
    // Windows：启动传参，无 app.nw 链
    return { shellApp, contentLink: contentRoot, created, relinked: false }
  }

  const resourcesDir = path.join(shellApp, 'Contents/Resources')
  const appNwLink = path.join(resourcesDir, 'app.nw')
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`壳结构异常，缺少 Contents/Resources: ${shellApp}`)
  }

  let relinked = false
  if (fs.existsSync(appNwLink) || isSymlink(appNwLink)) {
    const current = isSymlink(appNwLink) ? fs.readlinkSync(appNwLink) : null
    const currentResolved = current ? path.resolve(path.dirname(appNwLink), current) : null
    if (currentResolved !== contentRoot) {
      fs.rmSync(appNwLink, { recursive: true, force: true })
      linkContent(appNwLink, contentRoot)
      relinked = true
    }
  } else {
    linkContent(appNwLink, contentRoot)
    relinked = true
  }

  return { shellApp, contentLink: appNwLink, created, relinked }
}

/** 启动前确保共用壳指向当前内容根（macOS 重链 app.nw；Windows 无操作） */
export function ensureShellLinkedToContent(opts: { shellApp: string; contentRoot: string }): boolean {
  if (isWin32()) return false

  const shellApp = path.resolve(opts.shellApp)
  const contentRoot = path.resolve(opts.contentRoot)
  const appNwLink = path.join(shellApp, 'Contents/Resources/app.nw')
  const resourcesDir = path.dirname(appNwLink)
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`壳结构异常: ${shellApp}`)
  }

  let currentResolved: string | null = null
  if (isSymlink(appNwLink)) {
    try {
      currentResolved = path.resolve(path.dirname(appNwLink), fs.readlinkSync(appNwLink))
    } catch {
      currentResolved = null
    }
  } else if (fs.existsSync(appNwLink)) {
    try {
      currentResolved = fs.realpathSync(appNwLink)
    } catch {
      currentResolved = path.resolve(appNwLink)
    }
  }

  if (currentResolved && path.resolve(/* turbopackIgnore: true */ currentResolved) === contentRoot) return false

  if (fs.existsSync(appNwLink) || isSymlink(appNwLink)) {
    fs.rmSync(appNwLink, { recursive: true, force: true })
  }
  linkContent(appNwLink, contentRoot)
  return true
}

export function shellInstallHint(): string {
  const folder = `${DATA_DIR_NAME}/${SHELL_DIR_NAME}/${toolkitShellFolderName()}`
  return isWin32() ? `干净 NW.js（nw.exe），安装到工具 ${folder}（各作共用）` : `干净的 NW.js .app，安装到工具 ${folder}（各作共用）`
}

export type UninstallShellResult = {
  /** 已删除的壳路径 */
  removed: string[]
}

function toolkitShellCandidates(toolkitRoot?: string): string[] {
  const root = toolkitRoot ? path.resolve(toolkitRoot) : undefined
  const primary = root ? toolkitShellAppPath(root) : toolkitShellAppPath()
  const shellDir = path.dirname(primary)
  const dataDir = path.dirname(shellDir)
  const legacyWinLinux = LEGACY_SHELL_WIN_DIR_NAMES.map((n) => path.join(shellDir, n))

  if (isWin32() || process.platform === 'linux') {
    return [...new Set([primary, ...legacyWinLinux])]
  }

  const legacyInShell = root ? LEGACY_SHELL_APP_NAMES.map((n) => path.join(shellDir, n)) : LEGACY_SHELL_IN_SHELL_PATHS
  const legacyAtData = root ? LEGACY_SHELL_APP_NAMES.map((n) => path.join(dataDir, n)) : LEGACY_SHELL_AT_DATA_PATHS
  return [...new Set([primary, ...legacyInShell, ...legacyAtData])]
}

/**
 * 卸载用户安装到工具目录的共用壳（`data/shell/…` 及旧版 `data/*.app`）。
 * 不删壳源、不删已打包游戏自带的 .app / Game.exe。
 */
export function uninstallToolkitShell(toolkitRoot?: string): UninstallShellResult {
  const primary = toolkitRoot ? toolkitShellAppPath(path.resolve(toolkitRoot)) : toolkitShellAppPath()
  const dataDirResolved = path.resolve(path.dirname(path.dirname(primary))) + path.sep
  const removed: string[] = []

  for (const target of toolkitShellCandidates(toolkitRoot)) {
    const abs = path.resolve(target)
    // 只允许删 data/ 下已知壳名，防止误删用户壳源或游戏包
    if (!abs.startsWith(dataDirResolved)) continue
    if (!fs.existsSync(abs) && !isSymlink(abs)) continue
    fs.rmSync(abs, { recursive: true, force: true })
    removed.push(abs)
  }

  return { removed }
}

/** 工具目录里是否已有用户安装的共用壳 */
export function isToolkitShellInstalled(toolkitRoot?: string): boolean {
  return toolkitShellCandidates(toolkitRoot).some((p) => fs.existsSync(p) || isSymlink(p))
}
