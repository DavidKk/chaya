import {
  LEGACY_SHELL_APP_NAMES,
  LEGACY_SHELL_WIN_DIR_NAMES,
  PLUGIN_ENV_NAME,
  PLUGIN_LOADER_NAME,
  PRODUCT_DISPLAY_NAME,
  SHELL_APP_NAME,
  SHELL_WIN_DIR_NAME,
} from '@/constants/brand'
import { normalizeNwVersion, nwDownloadUrl, nwFileKey } from '@/lib/game/nw-download-meta'
import { buildChayaEnvJs, mergeLoaderPluginEntries } from '@/lib/game/plugins-merge'
import { parsePluginsJsEntries, serializePluginsJs } from '@/lib/game/plugins-parse'
import { TRACKED_PLUGINS } from '@/lib/game/types'

import {
  detectClientArch,
  detectClientOs,
  dirExists,
  ensurePath,
  fileExists,
  type FsaSupport,
  getDir,
  getFsaSupport,
  pickDirectory,
  readTextFile,
  resolveContentRootHandle,
  writeTextFile,
} from './fsa'
import { installWindowsShellFsa, isCompleteMacShell, isCompleteWinShell, looksLikeMacNwApp, writeShellLaunchers } from './nw-shell-fsa'

export { type FsaSupport, getFsaSupport }

export type CloudPrepareProgress = {
  phase: 'pick' | 'plugins' | 'shell' | 'done'
  message: string
  /** 0–100；下载/写入阶段有值 */
  percent?: number
}

export type CloudGame = {
  picked: FileSystemDirectoryHandle
  content: FileSystemDirectoryHandle
  os: ReturnType<typeof detectClientOs>
  pluginsInstalled: boolean
  existingShell?: string
}

async function dirHasLinuxNw(root: FileSystemDirectoryHandle, dirName: string): Promise<boolean> {
  if (!(await dirExists(root, dirName))) return false
  const dir = await getDir(root, dirName)
  for (const bin of ['nw', 'nwjs']) {
    if (await fileExists(dir, bin)) return true
  }
  return false
}

/** 只检测壳文件是否存在；浏览器无法验证 macOS 权限、软链接和签名 */
async function findExistingMacShell(picked: FileSystemDirectoryHandle, content: FileSystemDirectoryHandle): Promise<string | null> {
  const roots = picked === content ? [picked] : [picked, content]
  for (const root of roots) {
    if (await isCompleteMacShell(root, SHELL_APP_NAME)) return SHELL_APP_NAME
    for (const name of LEGACY_SHELL_APP_NAMES) {
      if (!(await dirExists(root, name))) continue
      const app = await getDir(root, name)
      if (await looksLikeMacNwApp(app)) return name
    }
  }
  return null
}

async function findExistingWinShell(picked: FileSystemDirectoryHandle, content: FileSystemDirectoryHandle): Promise<string | null> {
  const roots = picked === content ? [picked] : [picked, content]
  for (const root of roots) {
    if (await isCompleteWinShell(root, SHELL_WIN_DIR_NAME)) return SHELL_WIN_DIR_NAME
    for (const legacy of LEGACY_SHELL_WIN_DIR_NAMES) {
      if (await isCompleteWinShell(root, legacy)) return legacy
    }
  }
  return null
}

async function findExistingLinuxShell(picked: FileSystemDirectoryHandle, content: FileSystemDirectoryHandle): Promise<string | null> {
  const roots = picked === content ? [picked] : [picked, content]
  for (const root of roots) {
    if (await dirHasLinuxNw(root, SHELL_WIN_DIR_NAME)) return SHELL_WIN_DIR_NAME
    for (const legacy of LEGACY_SHELL_WIN_DIR_NAMES) {
      if (await dirHasLinuxNw(root, legacy)) return legacy
    }
  }
  return null
}

async function fetchPluginJs(name: string): Promise<string> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(name)}.js`)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`拉取插件 ${name} 失败：HTTP ${res.status}${t ? ` ${t.slice(0, 120)}` : ''}`)
  }
  return res.text()
}

async function injectPluginsIntoContent(content: FileSystemDirectoryHandle, apiBase: string, gameId?: string): Promise<{ written: string[]; pluginsJsUpdated: boolean }> {
  const base = apiBase.replace(/\/$/, '')
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(`无效的 API 根（须为当前页 origin）：${apiBase || '(空)'}`)
  }

  // Validate registration and download everything before the first game mutation.
  const jsDir = await getDir(content, 'js')
  const pluginsJsRaw = await readTextFile(jsDir, 'plugins.js')
  const parsed = pluginsJsRaw && parsePluginsJsEntries(pluginsJsRaw)
  if (!parsed) throw new Error('无法读取 js/plugins.js，未安装插件。请确认选择了完整的 RPG Maker 游戏。')
  const names = [PLUGIN_LOADER_NAME, ...TRACKED_PLUGINS]
  const bodies = await Promise.all(names.map(fetchPluginJs))
  const pluginsDir = await ensurePath(content, ['js', 'plugins'])
  const written: string[] = []
  for (const [i, name] of names.entries()) {
    await writeTextFile(pluginsDir, `${name}.js`, bodies[i])
    written.push(name)
  }
  await writeTextFile(pluginsDir, `${PLUGIN_ENV_NAME}.js`, buildChayaEnvJs(base, { gameId }))
  written.push(PLUGIN_ENV_NAME)
  const next = mergeLoaderPluginEntries(parsed.list, {
    name: PLUGIN_LOADER_NAME,
    status: true,
    description: `${PRODUCT_DISPLAY_NAME} 插件加载器`,
    parameters: {},
  })
  const nextRaw = serializePluginsJs(pluginsJsRaw, parsed.match, next)
  const pluginsJsUpdated = nextRaw !== pluginsJsRaw
  if (pluginsJsUpdated) await writeTextFile(jsDir, 'plugins.js', nextRaw)

  return { written, pluginsJsUpdated }
}

/**
 * 云端写入用的 API 根：始终等于当前打开本页的 origin（域名 / 局域网 IP / 127.0.0.1），
 * 不写死、不用服务端 preferredPluginApiBase。
 */
function pageOriginApiBase(override?: string): string {
  const fromOpt = String(override || '')
    .trim()
    .replace(/\/$/, '')
  if (fromOpt && /^https?:\/\//i.test(fromOpt)) return fromOpt
  if (typeof window === 'undefined' || !window.location?.origin || window.location.origin === 'null') {
    throw new Error('无法解析当前页面地址作为插件 API 根')
  }
  return window.location.origin.replace(/\/$/, '')
}

/** Selection only reads the game; explicit actions own all mutations. */
export async function selectCloudGame(): Promise<CloudGame> {
  if (!getFsaSupport().ok) throw new Error('请使用 Chrome 或 Edge，在安全地址中选择游戏目录')
  const picked = await pickDirectory({ mode: 'readwrite', id: 'chaya-cloud-game' })
  const content = await resolveContentRootHandle(picked)
  return inspectCloudGame({ picked, content, os: detectClientOs(), pluginsInstalled: false })
}

export async function inspectCloudGame(game: CloudGame): Promise<CloudGame> {
  const raw = await readTextFile(await getDir(game.content, 'js'), 'plugins.js')
  const parsed = raw && parsePluginsJsEntries(raw)
  const pluginsInstalled = !!parsed && parsed.list.some((p) => p.name === PLUGIN_LOADER_NAME && p.status === true)
  const finder = game.os === 'mac' ? findExistingMacShell : game.os === 'win' ? findExistingWinShell : findExistingLinuxShell
  const existingShell = (await finder(game.picked, game.content)) || undefined
  return { ...game, pluginsInstalled, existingShell }
}

export async function installCloudPlugins(game: CloudGame, gameId?: string): Promise<void> {
  await injectPluginsIntoContent(game.content, pageOriginApiBase(), gameId)
}

export async function clearCloudPlugins(game: CloudGame): Promise<void> {
  const js = await getDir(game.content, 'js')
  const raw = await readTextFile(js, 'plugins.js')
  const parsed = raw && parsePluginsJsEntries(raw)
  if (!parsed) throw new Error('无法读取 js/plugins.js，未清除插件。')
  const names = new Set<string>([PLUGIN_LOADER_NAME, PLUGIN_ENV_NAME, ...TRACKED_PLUGINS])
  const next = parsed.list.filter((p) => !names.has(p.name))
  await writeTextFile(js, 'plugins.js', serializePluginsJs(raw, parsed.match, next))
  if (await dirExists(js, 'plugins')) {
    const plugins = await getDir(js, 'plugins')
    for (const name of names) {
      try {
        await plugins.removeEntry(`${name}.js`)
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e
      }
    }
  }
}

export async function installCloudShell(game: CloudGame, onProgress?: (p: CloudPrepareProgress) => void): Promise<{ hint: string; downloadUrl?: string }> {
  if (game.os === 'mac') throw new Error('macOS 请复制安装命令，在终端中执行。')
  if (game.os === 'win') {
    // Always install the canonical shell: legacy shells may live elsewhere and cannot use this launcher.
    if (!(await isCompleteWinShell(game.picked, SHELL_WIN_DIR_NAME))) await installWindowsShellFsa(game.picked, onProgress)
    const launcher = await writeShellLaunchers(game.picked, 'win')
    return { hint: `壳已就绪。双击 ${launcher} 启动游戏。` }
  }
  if (game.os === 'linux') {
    const response = await fetch('https://nwjs.io/versions.json')
    if (!response.ok) throw new Error(`拉取 NW.js 版本失败 HTTP ${response.status}`)
    const data = (await response.json()) as { stable?: string; latest?: string }
    const version = normalizeNwVersion(data.stable || data.latest || '')
    return {
      hint: `下载后解压为游戏目录中的 ${SHELL_WIN_DIR_NAME}/，使用其中的 nw 程序打开游戏内容目录。`,
      downloadUrl: nwDownloadUrl(version, nwFileKey('linux', detectClientArch())),
    }
  }
  throw new Error('当前系统不支持安装壳')
}

/** Update only the connection config for an already installed game. */
export async function configureCloudConnection(game: CloudGame, gameId: string): Promise<void> {
  if (!gameId.trim()) throw new Error('未选择游戏')
  const fresh = await inspectCloudGame(game)
  if (!fresh.pluginsInstalled) throw new Error('请先安装插件，再连接游戏')
  const plugins = await getDir(await getDir(game.content, 'js'), 'plugins')
  await writeTextFile(plugins, `${PLUGIN_ENV_NAME}.js`, buildChayaEnvJs(pageOriginApiBase(), { gameId }))
}
