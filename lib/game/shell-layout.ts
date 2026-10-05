import fs from 'node:fs'
import path from 'node:path'

import { SHELL_APP_NAME, SHELL_BUNDLE_BASE, SHELL_WIN_DIR_NAME, WIN_SHELL_EXE_NAMES } from '@/constants/brand'
import { IS_WIN32 } from '@/constants/paths'

export { SHELL_APP_NAME, SHELL_BUNDLE_BASE, SHELL_WIN_DIR_NAME, WIN_SHELL_EXE_NAMES }

export function isWin32(platform = process.platform): boolean {
  if (platform === process.platform) return IS_WIN32
  return platform === 'win32'
}

/**
 * 共用壳在 data/shell/（或游戏旁）下的统一目录名：
 * mac → Chaya.app；win/linux → Chaya
 */
export function toolkitShellFolderName(platform = process.platform): string {
  if (isWin32(platform) || platform === 'linux') return SHELL_WIN_DIR_NAME
  return SHELL_APP_NAME
}

export function findNwExeInDir(dir: string): string | null {
  for (const name of WIN_SHELL_EXE_NAMES) {
    const p = path.join(/* turbopackIgnore: true */ dir, name)
    if (fs.existsSync(/* turbopackIgnore: true */ p)) return p
  }
  return null
}

const LINUX_NW_BIN_NAMES = ['nw', 'nwjs', 'Game'] as const

/** Linux：目录内的 nw / nwjs 可执行文件 */
export function findNwLinuxBinary(dir: string): string | null {
  for (const name of LINUX_NW_BIN_NAMES) {
    const p = path.join(/* turbopackIgnore: true */ dir, name)
    try {
      if (fs.existsSync(/* turbopackIgnore: true */ p) && fs.statSync(/* turbopackIgnore: true */ p).isFile()) return p
    } catch {
      /* */
    }
  }
  return null
}

export function looksLikeMacNwApp(appPath: string): boolean {
  try {
    return fs.readdirSync(/* turbopackIgnore: true */ path.join(appPath, 'Contents/MacOS')).some((b) => /nw/i.test(b) || b === 'node-webkit')
  } catch {
    return false
  }
}

/** 是否是可用壳：能解析到真实目录，且按平台找得到壳可执行文件（删到一半的残骸不算） */
export function validShellExists(p: string): boolean {
  try {
    if (!fs.statSync(/* turbopackIgnore: true */ p).isDirectory()) return false
  } catch {
    return false
  }
  if (process.platform === 'darwin') return looksLikeMacNwApp(p)
  return Boolean(findNwExeInDir(p) || findNwLinuxBinary(p))
}

function isLinuxNwBinaryPath(p: string): boolean {
  const base = path.basename(p)
  return LINUX_NW_BIN_NAMES.some((n) => n.toLowerCase() === base.toLowerCase())
}

/** 壳源 / 已装壳 → 可执行文件（Windows）、.app（macOS）或 nw 二进制（Linux） */
export function resolveShellLaunchTarget(shellRootOrExe: string): string {
  const p = path.resolve(shellRootOrExe)
  if (p.toLowerCase().endsWith('.exe') && fs.existsSync(/* turbopackIgnore: true */ p)) return p
  if (p.toLowerCase().endsWith('.app') && fs.existsSync(/* turbopackIgnore: true */ p)) return p
  if (fs.existsSync(/* turbopackIgnore: true */ p) && fs.statSync(/* turbopackIgnore: true */ p).isFile() && isLinuxNwBinaryPath(p)) return p
  const exe = findNwExeInDir(p)
  if (exe) return exe
  const linuxBin = findNwLinuxBinary(p)
  if (linuxBin) return linuxBin
  throw new Error(`未找到可启动的壳：${p}（Windows 需 nw.exe，macOS 需 .app，Linux 需 nw）`)
}

/** macOS：`.app/Contents/MacOS` 下的 NW 可执行文件（用于 `nwjs <contentRoot>`） */
export function findNwMacBinary(shellApp: string): string {
  const app = path.resolve(shellApp)
  const macOs = path.join(app, 'Contents/MacOS')
  if (!fs.existsSync(macOs)) {
    throw new Error(`壳结构异常，缺少 Contents/MacOS: ${app}`)
  }
  const preferred = ['nwjs', 'node-webkit', 'nw']
  for (const name of preferred) {
    const bin = path.join(macOs, name)
    if (fs.existsSync(bin)) return bin
  }
  try {
    const hit = fs.readdirSync(macOs).find((b) => /^(nwjs|nw|node-webkit)/i.test(b) && !b.includes('Helper'))
    if (hit) return path.join(macOs, hit)
  } catch {
    /* */
  }
  throw new Error(`壳内未找到 nwjs 可执行文件: ${macOs}`)
}

/** 用户选的壳源 → 要拷贝的根目录（可为 nw.exe / nw 二进制或其父目录，或 .app） */
export function resolveShellSourceRoot(shellSource: string): string {
  const p = path.resolve(shellSource)
  if (!fs.existsSync(/* turbopackIgnore: true */ p)) throw new Error(`壳源路径不存在: ${p}`)
  if (p.toLowerCase().endsWith('.exe')) return path.dirname(p)
  if (fs.statSync(/* turbopackIgnore: true */ p).isFile()) {
    if (isLinuxNwBinaryPath(p)) return path.dirname(p)
    throw new Error('壳源需为 nw.exe / nw 可执行文件、含壳的目录，或 macOS .app')
  }
  if (fs.statSync(/* turbopackIgnore: true */ p).isDirectory()) {
    if (isWin32()) {
      if (!findNwExeInDir(p)) throw new Error('壳源目录内未找到 nw.exe / Game.exe')
    } else if (p.toLowerCase().endsWith('.app')) {
      /* macOS bundle */
    } else if (!findNwLinuxBinary(p)) {
      throw new Error('壳源需为 .app（macOS）或含 nw / nwjs 的目录（Linux）')
    }
    return p
  }
  throw new Error('壳源路径无效')
}

export function looksLikeNwShellSource(shellSource: string): boolean {
  try {
    resolveShellSourceRoot(shellSource)
    return true
  } catch {
    return false
  }
}

/** 自内容根向上找同目录旁挂的 Game.exe / nw.exe（Windows 已打包） */
export function findEnclosingWinExe(contentRoot: string, maxUp = 5): string | null {
  let cur = path.resolve(contentRoot)
  for (let i = 0; i < maxUp; i++) {
    const exe = findNwExeInDir(cur)
    if (exe) return exe
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
  return null
}

/** 自内容根向上找旁挂的 Game / nw（Linux 已打包） */
export function findEnclosingLinuxBinary(contentRoot: string, maxUp = 5): string | null {
  let cur = path.resolve(contentRoot)
  for (let i = 0; i < maxUp; i++) {
    const bin = findNwLinuxBinary(cur)
    if (bin) return bin
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
  return null
}
