import fs from 'node:fs'
import path from 'node:path'

import { LEGACY_SHELL_APP_NAMES, SHELL_APP_NAME, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import type { ResolvedGame } from '@/lib/game'
import {
  buildPluginInfo,
  chromiumFromFrameworkVersions,
  detectEngine,
  ENGINE_CORE_CANDIDATES,
  type EngineLib,
  type GameFingerprint,
  type GameFingerprintSummary,
  isChromiumVersion,
  type PackageInfo,
  parseCoreScript,
  parseLibVersion,
  parsePackageJson,
  parseSystemJson,
  plistString,
  PLUGIN_SOURCE_READ_BYTES,
  pluginStats,
  readPeVersion,
  type ShellInfo,
  summarizeFingerprint,
} from '@/lib/game/fingerprint'
import { parsePluginsJsEntries } from '@/lib/game/plugins-parse'

const CORE_READ_BYTES = 512 * 1024
const LIB_HEAD_BYTES = 1024
/** 核心脚本被合并时，最多翻几个顶层脚本找 `Utils.RPGMAKER_NAME` */
const MAX_BUNDLED_SCRIPT_PROBES = 6
const MANAGED_MAC_SHELLS = new Set<string>([SHELL_APP_NAME, ...LEGACY_SHELL_APP_NAMES])

function readHead(file: string, bytes: number): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(/* turbopackIgnore: true */ file, 'r')
    const buffer = Buffer.alloc(bytes)
    const read = fs.readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd != null) fs.closeSync(fd)
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function listDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function exists(file: string): boolean {
  return fs.existsSync(/* turbopackIgnore: true */ file)
}

function relative(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).split(path.sep).join('/') || '.'
}

function collectEngine(contentRoot: string) {
  const jsDir = path.join(contentRoot, 'js')
  const jsFiles = listDir(jsDir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
  const libs: EngineLib[] = listDir(path.join(jsDir, 'libs'))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => ({ name: entry.name, version: parseLibVersion(readHead(path.join(jsDir, 'libs', entry.name), LIB_HEAD_BYTES) ?? '') }))

  let coreSource: string | null = null
  for (const file of ENGINE_CORE_CANDIDATES) {
    if (jsFiles.includes(file)) {
      coreSource = readHead(path.join(jsDir, file), CORE_READ_BYTES)
      break
    }
  }
  if (!coreSource) {
    const probes = jsFiles.filter((file) => file !== 'plugins.js').slice(0, MAX_BUNDLED_SCRIPT_PROBES)
    for (const file of probes) {
      const source = readHead(path.join(jsDir, file), CORE_READ_BYTES)
      if (source && parseCoreScript(source).source !== 'none') {
        coreSource = source
        break
      }
    }
  }
  return detectEngine({ jsFiles, coreSource, libs })
}

function collectPlugins(contentRoot: string) {
  let raw: string | null = null
  try {
    raw = fs.readFileSync(/* turbopackIgnore: true */ path.join(contentRoot, 'js', 'plugins.js'), 'utf8')
  } catch {
    return []
  }
  const parsed = parsePluginsJsEntries(raw)
  if (!parsed) return []
  return parsed.list
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim())
    .map((entry) => buildPluginInfo(entry, readHead(path.join(contentRoot, 'js', 'plugins', `${entry.name}.js`), PLUGIN_SOURCE_READ_BYTES)))
}

function collectPackage(resolved: ResolvedGame): PackageInfo | null {
  const candidates = Array.from(new Set([resolved.projectRoot, resolved.contentRoot]))
  for (const dir of candidates) {
    const file = path.join(dir, 'package.json')
    if (!exists(file)) continue
    const info = parsePackageJson(readJson(file), relative(resolved.projectRoot, file))
    if (info) return info
  }
  return null
}

function macShell(app: string, projectRoot: string): ShellInfo {
  const frameworks = path.join(app, 'Contents', 'Frameworks')
  const names = listDir(frameworks).map((entry) => entry.name)
  const managed = MANAGED_MAC_SHELLS.has(path.basename(app))
  if (names.includes('Electron Framework.framework')) return { runtime: 'electron', platform: 'mac', path: relative(projectRoot, app), chromium: null, managed }
  const nwFramework = names.find((name) => /^nwjs Framework\.framework$/i.test(name))
  if (nwFramework) {
    const versions = listDir(path.join(frameworks, nwFramework, 'Versions')).map((entry) => entry.name)
    const chromium = chromiumFromFrameworkVersions(versions) ?? plistString(readHead(path.join(app, 'Contents', 'Info.plist'), 64 * 1024) ?? '', 'CFBundleShortVersionString')
    return { runtime: 'nwjs', platform: 'mac', path: relative(projectRoot, app), chromium: isChromiumVersion(chromium) ? chromium : null, managed }
  }
  return { runtime: 'unknown', platform: 'mac', path: relative(projectRoot, app), chromium: null, managed }
}

function readExeVersion(exe: string): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(/* turbopackIgnore: true */ exe, 'r')
    const handle = fd
    const version = readPeVersion((offset, length) => {
      const buffer = Buffer.alloc(length)
      const read = fs.readSync(handle, buffer, 0, length, offset)
      return buffer.subarray(0, read)
    })
    const value = version?.productVersion ?? version?.fileVersion ?? null
    return isChromiumVersion(value) ? value : null
  } catch {
    return null
  } finally {
    if (fd != null) fs.closeSync(fd)
  }
}

function windowsShells(dir: string, projectRoot: string, managed: boolean): ShellInfo[] {
  const entries = listDir(dir)
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()))
  const electron = exists(path.join(dir, 'resources', 'app.asar')) || exists(path.join(dir, 'resources', 'electron.asar'))
  const nw = names.has('nw.dll') || names.has('nw.pak') || names.has('nw_elf.dll')
  if (!electron && !nw) return []
  const exes = entries.filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name) && !/^(notification_helper|crashpad_handler|nwjc|payload)\.exe$/i.test(entry.name))
  const exe = exes.find((entry) => /^(game|nw)\.exe$/i.test(entry.name)) ?? exes[0]
  if (!exe) return []
  const exePath = path.join(dir, exe.name)
  return [{ runtime: electron ? 'electron' : 'nwjs', platform: 'windows', path: relative(projectRoot, exePath), chromium: electron ? null : readExeVersion(exePath), managed }]
}

function collectShells(resolved: ResolvedGame): ShellInfo[] {
  const root = resolved.projectRoot
  const shells: ShellInfo[] = []
  if (resolved.bundled && resolved.shellApp.toLowerCase().endsWith('.app')) shells.push(macShell(resolved.shellApp, root))
  for (const entry of listDir(root)) {
    if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith('.app')) continue
    const app = path.join(root, entry.name)
    if (!shells.some((shell) => path.resolve(root, shell.path) === app)) shells.push(macShell(app, root))
  }
  shells.push(...windowsShells(root, root, false))
  shells.push(...windowsShells(path.join(root, SHELL_WIN_DIR_NAME), root, true))
  return shells
}

export function collectGameFingerprint(resolved: ResolvedGame): GameFingerprint {
  const plugins = collectPlugins(resolved.contentRoot)
  return {
    engine: collectEngine(resolved.contentRoot),
    system: parseSystemJson(readJson(path.join(resolved.contentRoot, 'data', 'System.json'))),
    package: collectPackage(resolved),
    shells: collectShells(resolved),
    plugins,
    pluginStats: pluginStats(plugins),
    collectedAt: Date.now(),
  }
}

function mtime(file: string): number {
  try {
    return fs.statSync(/* turbopackIgnore: true */ file).mtimeMs
  } catch {
    return 0
  }
}

/** 这些路径没变就复用上次结果；游戏库列表会频繁请求 */
function cacheKey(resolved: ResolvedGame): string {
  const { contentRoot, projectRoot } = resolved
  return [
    path.join(contentRoot, 'js'),
    path.join(contentRoot, 'js', 'plugins.js'),
    path.join(contentRoot, 'js', 'plugins'),
    path.join(contentRoot, 'data', 'System.json'),
    path.join(contentRoot, 'package.json'),
    projectRoot,
  ]
    .map(mtime)
    .join(':')
}

const cache = new Map<string, { key: string; value: GameFingerprint }>()
const MAX_CACHE_ENTRIES = 200

export function getGameFingerprint(resolved: ResolvedGame): GameFingerprint | null {
  if (resolved.remote) return null
  const key = cacheKey(resolved)
  const hit = cache.get(resolved.contentRoot)
  if (hit && hit.key === key) return hit.value
  try {
    const value = collectGameFingerprint(resolved)
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
    cache.set(resolved.contentRoot, { key, value })
    return value
  } catch {
    return null
  }
}

export function getGameFingerprintSummary(resolved: ResolvedGame): GameFingerprintSummary | undefined {
  const fingerprint = getGameFingerprint(resolved)
  return fingerprint ? summarizeFingerprint(fingerprint) : undefined
}
