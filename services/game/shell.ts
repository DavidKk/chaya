import fs from 'node:fs'
import path from 'node:path'

import { LEGACY_SHELL_APP_NAMES, LEGACY_SHELL_WIN_DIR_NAMES } from '@/constants/brand'
import { DATA_DIR_NAME, SHELL_DIR_NAME } from '@/constants/path-names'
import { LEGACY_SHELL_AT_DATA_PATHS, LEGACY_SHELL_IN_SHELL_PATHS } from '@/constants/paths'
import { findNwExeInDir, findNwLinuxBinary, isWin32, looksLikeNwShellSource, resolveShellSourceRoot, toolkitShellFolderName } from '@/lib/game/shell-layout'
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

/** 只有 macOS 用 `.app` + `app.nw` 链接；Windows / Linux 由启动参数传内容根 */
function isMacHost(): boolean {
  return process.platform === 'darwin'
}

/** 路径名是否被占用（不跟随符号链接，失效链接也算） */
export function pathEntryExists(p: string): boolean {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

/** 是否是可用壳：能解析到真实目录，且按平台找得到壳可执行文件 */
export function validShellExists(p: string): boolean {
  try {
    if (!fs.statSync(p).isDirectory()) return false
  } catch {
    return false
  }
  if (isMacHost()) return looksLikeMacNwApp(p)
  return Boolean(findNwExeInDir(p) || findNwLinuxBinary(p))
}

export class ShellSwapError extends Error {
  constructor(
    readonly code: 'SHELL_IN_USE' | 'SHELL_SWAP_RECOVERY_REQUIRED',
    message: string
  ) {
    super(message)
  }
}

function swapPaths(shellApp: string) {
  const dir = path.dirname(shellApp)
  const name = path.basename(shellApp)
  return { dir, staging: path.join(dir, `.${name}.staging`), old: path.join(dir, `.${name}.old`), broken: path.join(dir, `.${name}.broken`) }
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Windows 上刚复制的文件可能被杀毒软件短暂占用：间隔 200 ms 重试 3 次 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      const code = errCode(e)
      if (attempt >= 3 || !code || !RENAME_RETRY_CODES.has(code)) throw e
      sleepSync(200)
    }
  }
}

function recoveryRequired(old: string, cause: unknown): ShellSwapError {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new ShellSwapError('SHELL_SWAP_RECOVERY_REQUIRED', `共用壳替换未完成且自动恢复失败，旧壳保留在 ${old}，请手动改回原名后重试（${detail}）`)
}

/**
 * 上次替换 / 回滚中途进程退出时，把 `.old` 恢复为正式壳。
 * 安装、启动、读取状态前都要调用，且必须在解析游戏状态之前。返回是否做了恢复。
 */
export function recoverOldIfNeeded(shellApp: string = toolkitShellAppPath()): boolean {
  const { old, broken } = swapPaths(path.resolve(shellApp))
  if (validShellExists(shellApp) || !validShellExists(old)) return false
  try {
    if (pathEntryExists(shellApp)) {
      if (fs.lstatSync(shellApp).isDirectory()) {
        fs.rmSync(broken, { recursive: true, force: true })
        fs.renameSync(shellApp, broken)
      } else {
        fs.unlinkSync(shellApp)
      }
    }
    fs.renameSync(old, shellApp)
  } catch (e) {
    throw recoveryRequired(old, e)
  }
  return true
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

  if (!isMacHost()) {
    if (!looksLikeNwShellSource(src)) {
      return isWin32() ? '壳源需为 nw.exe，或含 nw.exe 的 NW.js 目录' : '壳源需为 nw 可执行文件，或含 nw 的 NW.js 目录'
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

function copyShellSource(shellSourceRoot: string, dest: string): void {
  fs.cpSync(shellSourceRoot, dest, {
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
}

/** 复制到暂存目录 → 旧壳改名 `.old` → 暂存改为正式名；失败回滚，旧壳不受影响 */
function swapInShell(shellSourceRoot: string, shellApp: string, contentRoot: string): void {
  const { dir, staging, old } = swapPaths(shellApp)
  fs.mkdirSync(dir, { recursive: true })
  fs.rmSync(staging, { recursive: true, force: true })
  // recoverOldIfNeeded 之后：正式壳可用，或 .old 不可用，两种情况 .old 都可清理
  if (validShellExists(shellApp) || !validShellExists(old)) fs.rmSync(old, { recursive: true, force: true })

  try {
    copyShellSource(shellSourceRoot, staging)
    if (isMacHost()) {
      const resourcesDir = path.join(staging, 'Contents/Resources')
      if (!fs.existsSync(resourcesDir)) throw new Error(`壳结构异常，缺少 Contents/Resources: ${shellSourceRoot}`)
      linkContent(path.join(resourcesDir, 'app.nw'), contentRoot)
    }
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }

  const hadFormal = pathEntryExists(shellApp)
  if (hadFormal) {
    try {
      renameWithRetry(shellApp, old)
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true })
      const code = errCode(e)
      if (code && RENAME_RETRY_CODES.has(code)) throw new ShellSwapError('SHELL_IN_USE', '游戏正在运行（共用壳被占用），请退出游戏后重新下载 / 安装')
      throw e
    }
  }
  try {
    renameWithRetry(staging, shellApp)
  } catch (e) {
    if (hadFormal) {
      try {
        fs.renameSync(old, shellApp)
      } catch {
        throw recoveryRequired(old, e)
      }
    }
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }
  if (validShellExists(shellApp)) {
    try {
      fs.rmSync(old, { recursive: true, force: true })
    } catch {
      /* 下次安装再清理 */
    }
  }
}

/**
 * 把干净 NW.js 装到工具 `data/shell/…`（全游戏共用一份）。
 * - macOS：拷 .app，并把 app.nw 链到内容根
 * - Windows / Linux：拷 nw 目录；启动时传内容根参数
 * 替换已有壳时走暂存目录 + 改名，失败回滚到旧壳。
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

  if (isMacHost() && contentRoot.includes(`${path.sep}Contents${path.sep}`)) {
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

  if (contentRoot === shellApp || contentRoot.startsWith(shellApp + path.sep)) {
    throw new Error('内容根不能位于共用壳内部')
  }

  recoverOldIfNeeded(shellApp)
  let created = false
  if (opts.force || !validShellExists(shellApp)) {
    swapInShell(shellSourceRoot, shellApp, contentRoot)
    created = true
  }

  if (!isMacHost()) {
    // Windows / Linux：启动传参，无 app.nw 链
    return { shellApp, contentLink: contentRoot, created, relinked: false }
  }

  const resourcesDir = path.join(shellApp, 'Contents/Resources')
  const appNwLink = path.join(resourcesDir, 'app.nw')
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`壳结构异常，缺少 Contents/Resources: ${shellApp}`)
  }

  let relinked = created
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

/** 启动前确保共用壳指向当前内容根（macOS 重链 app.nw；Windows / Linux 无操作） */
export function ensureShellLinkedToContent(opts: { shellApp: string; contentRoot: string }): boolean {
  if (!isMacHost()) return false

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

  // 卸载后不应再被 recoverOldIfNeeded 从 .old 恢复回来
  const leftovers = Object.values(swapPaths(primary)).filter((p) => p !== path.dirname(primary))
  for (const target of [...toolkitShellCandidates(toolkitRoot), ...leftovers]) {
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
