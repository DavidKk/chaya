import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { isRgssRuntimeInstalled, toolkitRgssBinary, toolkitRgssDir } from '@/lib/game/toolkit-data'
import type { ResolvedGame } from '@/lib/game/types'
import { disconnectAgentGame } from '@/services/runtime/agent-bridge'
import { clearLaunchToken, issueLaunchToken } from '@/services/runtime/launch-token'
import { toolkitListenPort } from '@/services/runtime/presence'
import { getSignalingRoom } from '@/services/runtime/webrtc-signaling'
import { publicGameFiles } from '@/services/storage/game-files'

import { ensureGameAppIcon, updateSharedMacAppIcon } from './app-icon'
import { loadConfig } from './config'
import { findLibraryEntry } from './library'
import { detectRgssPlugins } from './rgss-plugins'

type Session = { child?: ChildProcess; running: boolean; starting: boolean; logPath: string; error?: string; tail: string; quitting?: boolean; roomId?: string; token?: string }
const globalSessions = globalThis as typeof globalThis & { __chayaRgssSessions?: Map<string, Session> }
const sessions = () => (globalSessions.__chayaRgssSessions ??= new Map())

export type RgssRuntimeChangeEvent = {
  root: string
  running: boolean
  starting: boolean
}
type RuntimeListener = (event: RgssRuntimeChangeEvent) => void

const globalListeners = globalThis as typeof globalThis & { __chayaRgssRuntimeListeners?: Set<RuntimeListener> }
const runtimeListeners = () => (globalListeners.__chayaRgssRuntimeListeners ??= new Set())

function notifyRuntimeChange(root: string, running: boolean, starting = false) {
  for (const listener of [...runtimeListeners()]) {
    try {
      listener({ root, running, starting })
    } catch {
      /* ignore */
    }
  }
}

export function onRgssRuntimeChange(listener: RuntimeListener): () => void {
  runtimeListeners().add(listener)
  return () => {
    runtimeListeners().delete(listener)
  }
}

function stopProcess(session: Session): boolean {
  const child = session.child
  if (!child || !session.running) return false
  session.quitting = true
  const sent = child.kill('SIGTERM')
  // SDL's native error dialog can block its SIGTERM handler. Only escalate our own child.
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3_000)
  timer.unref()
  child.once('close', () => clearTimeout(timer))
  return sent
}

export function rgssRuntimeStatus(contentRoot: string) {
  const session = sessions().get(path.resolve(contentRoot))
  const room = session?.roomId ? getSignalingRoom(session.roomId) : null
  return {
    name: process.platform === 'win32' ? 'Game.exe' : 'mkxp-z',
    running: !!session?.running,
    starting: !!session?.starting,
    logPath: session?.logPath,
    error: session?.error,
    bridgeConnected: !!session?.running && !!room?.webConnected && Date.now() - room.updatedAt <= 45_000,
    roomId: session?.running ? session.roomId : undefined,
  }
}

export function anyRgssRunning(): boolean {
  return [...sessions().values()].some((session) => session.running || session.starting)
}

export function uninstallRgssRuntime() {
  if (anyRgssRunning()) throw new Error('Quit the RGSS game before changing its runtime')
  const installed = path.dirname(toolkitRgssBinary())
  if (!fs.existsSync(installed)) return { removed: [] as string[] }
  // Only the downloaded runtime. Per-game launch logs and original game files remain untouched.
  fs.rmSync(installed, { recursive: true, force: true })
  return { removed: [installed] }
}

export async function launchRgss(resolved: ResolvedGame) {
  const root = path.resolve(resolved.contentRoot)
  if (anyRgssRunning()) throw new Error('An RGSS game is already running or starting')
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Native RGSS launch is currently supported on macOS and Windows only')
  if (!detectRgssPlugins(root).every((plugin) => plugin.registered && plugin.fileExists)) throw new Error('Install the RGSS plugin before launching the game')
  const key = createHash('sha256').update(root).digest('hex').slice(0, 24)
  const sessionDir = path.join(toolkitRgssDir(), 'games', key)
  fs.mkdirSync(sessionDir, { recursive: true })
  const state: Session = { starting: true, running: false, logPath: path.join(sessionDir, 'runtime.log'), tail: '' }
  sessions().set(root, state)
  notifyRuntimeChange(root, false, true)
  try {
    let binary = resolved.shellApp
    if (process.platform === 'darwin') {
      const installed = toolkitRgssBinary()
      if (!isRgssRuntimeInstalled()) throw new Error('Install or reinstall the complete mkxp-z runtime first')
      // mkxp-z reads mkxp.json from Contents/Game, not from a --config argument.
      // An isolated copy gives every game its own config without touching Game.ini / Game.rgss3a.
      const app = path.join(sessionDir, 'Chaya RGSS.app')
      const contents = path.join(app, 'Contents')
      const gameDir = path.join(contents, 'Game')
      binary = path.join(contents, 'MacOS', 'mkxp-z')
      fs.mkdirSync(path.dirname(binary), { recursive: true })
      fs.mkdirSync(gameDir, { recursive: true })
      fs.writeFileSync(
        path.join(contents, 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>mkxp-z</string>
<key>CFBundleIconFile</key><string>Chaya.icns</string>
<key>CFBundleIdentifier</key><string>app.chaya.rgss.${key}</string>
<key>CFBundleName</key><string>Chaya RGSS</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`
      )
      fs.copyFileSync(installed, `${binary}.new`, fs.constants.COPYFILE_FICLONE)
      fs.chmodSync(`${binary}.new`, 0o755)
      fs.renameSync(`${binary}.new`, binary)
      let gameIcon: string | undefined
      try {
        gameIcon = (await ensureGameAppIcon(root)).icon
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error), { code: 'CHAYA_GAME_ICON' })
      }
      if (gameIcon) {
        try {
          await updateSharedMacAppIcon(app, root, gameIcon, {
            bundleId: `app.chaya.rgss.${key}`,
            bundleName: 'Chaya RGSS',
            displayName: 'Chaya RGSS',
          })
        } catch (error) {
          process.emitWarning(error instanceof Error ? error : String(error), { code: 'CHAYA_MAC_APP_ICON' })
        }
      }
      const preload = path.join(root, 'chaya', 'plugins', 'rgss', 'preload.rb')
      if (!fs.existsSync(preload)) throw new Error('Chaya RGSS preload is missing; reinstall Chaya')
      for (const asset of ['rgss-overlay.html', 'ChayaRGSSOverlay.js', 'libchaya-overlay.dylib']) {
        if (!fs.existsSync(path.join(root, 'chaya', 'plugins', 'rgss', 'dist', asset))) throw new Error(`Chaya RGSS overlay asset is missing: ${asset}; rebuild or reinstall Chaya`)
      }
      // Mount session-only font resources; never modify the game's Fonts folder.
      const fontResources = path.join(sessionDir, 'resources')
      const fontDir = path.join(fontResources, 'Fonts')
      fs.mkdirSync(fontDir, { recursive: true })
      const candidateFonts: Array<{ file: string; links: string[] }> = [
        {
          file: '/System/Library/Fonts/Hiragino Sans GB.ttc',
          links: ['Hiragino Sans GB.ttf', 'HiraginoSansGB.ttf', 'Hiragino Sans GB W3.ttf'],
        },
        {
          file: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
          links: ['Arial Unicode MS.ttf', 'ArialUnicodeMS.ttf'],
        },
        {
          file: '/System/Library/Fonts/STHeiti Medium.ttc',
          links: ['STHeiti Medium.ttf', 'STHeitiMedium.ttf', 'Heiti SC.ttf'],
        },
        {
          file: '/System/Library/Fonts/STHeiti Light.ttc',
          links: ['ChayaHeiti.ttf'],
        },
        {
          file: '/System/Library/Fonts/Supplemental/Songti.ttc',
          links: ['Songti SC.ttf', 'Songti.ttf'],
        },
      ]
      let hasMountedFont = false
      for (const { file, links } of candidateFonts) {
        if (fs.existsSync(file)) {
          for (const link of links) {
            const fontLink = path.join(fontDir, link)
            if (!fs.existsSync(fontLink)) {
              try {
                fs.symlinkSync(file, fontLink)
              } catch {
                /* ignore */
              }
            }
          }
          hasMountedFont = true
        }
      }
      fs.writeFileSync(
        path.join(gameDir, 'mkxp.json'),
        JSON.stringify(
          {
            gameFolder: root,
            rgssVersion: resolved.engine === 'VX Ace' ? 3 : 2,
            execName: 'Game',
            // Upstream dev builds can crash in createPathCache on encrypted RGSS3 archives.
            pathCache: false,
            allowSymlinks: true,
            RTP: hasMountedFont ? [fontResources] : [],
            rubyLoadpath: [path.join(path.dirname(installed), 'stdlib')],
            preloadScript: [preload],
          },
          null,
          2
        )
      )
    }
    fs.writeFileSync(state.logPath, `Chaya native RGSS: ${new Date().toISOString()}\n${root}\n`)
    const config = loadConfig()
    const gameRoot = String(config.gameRoot || resolved.selected || resolved.contentRoot || '').trim()
    const entry = findLibraryEntry(config.library, gameRoot)
    state.roomId = entry?.id || `rgss-${randomUUID()}`
    state.token = issueLaunchToken({ gameRoot: root, libraryId: state.roomId }).token
    const releaseBridge = () => {
      if (state.token) clearLaunchToken(state.token)
      if (state.roomId) disconnectAgentGame(state.roomId)
    }
    const child = spawn(binary, [], {
      cwd: process.platform === 'darwin' ? sessionDir : root,
      env: {
        ...process.env,
        MKXPZ_FOLDER_SELECT: '0',
        CHAYA_RGSS_RUNTIME: path.dirname(toolkitRgssBinary()),
        CHAYA_RGSS_SESSION: sessionDir,
        CHAYA_RGSS_CONTENT_ROOT: root,
        CHAYA_PUBLIC_GAME_DIR: publicGameFiles(root).directory,
        CHAYA_RGSS_API: `http://127.0.0.1:${toolkitListenPort()}`,
        CHAYA_RGSS_ROOM: state.roomId || '',
        CHAYA_RGSS_TOKEN: state.token || '',
        CHAYA_RGSS_TRANSLATION_DEBUG: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    state.child = child
    const record = (chunk: Buffer) => {
      const text = chunk.toString()
      state.tail = (state.tail + text).slice(-12_000)
      fs.appendFileSync(state.logPath, text)
      const fatal = /^.*:\d+:in .*\((?:\w*Error|\w*Exception)\)/m.exec(state.tail)
      if (fatal && !state.error) {
        state.error = state.tail.slice(fatal.index).trim()
        stopProcess(state)
      }
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.once('error', (error) => {
      releaseBridge()
      state.error = error.message
      state.running = false
      state.starting = false
      notifyRuntimeChange(root, false, false)
    })
    child.once('spawn', () => {
      state.running = true
      notifyRuntimeChange(root, true, false)
    })
    child.once('close', (code, signal) => {
      releaseBridge()
      state.running = false
      state.starting = false
      if (code !== 0 && !state.quitting) state.error = `${state.tail.trim() || 'Native RGSS exited'} (exit ${code ?? signal})`
      fs.appendFileSync(state.logPath, `\nProcess exited: ${code ?? signal}\n`)
      notifyRuntimeChange(root, false, false)
    })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    state.starting = false
    if (state.error || !state.running) throw new Error(state.error || state.tail.trim() || 'The RGSS process exited during startup')
    return { path: binary, contentRoot: root, mode: 'native-rgss', engine: resolved.engine, pid: child.pid, logPath: state.logPath }
  } catch (error) {
    if (state.token) clearLaunchToken(state.token)
    if (state.roomId) disconnectAgentGame(state.roomId)
    state.starting = false
    state.error = error instanceof Error ? error.message : String(error)
    notifyRuntimeChange(root, false, false)
    throw error
  }
}

export function quitRgss(contentRoot: string): boolean {
  const session = sessions().get(path.resolve(contentRoot))
  if (!session?.child || !session.running) return false
  return stopProcess(session)
}
