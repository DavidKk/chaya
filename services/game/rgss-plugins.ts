import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

import { ROOT_PATH } from '@/constants/paths'
import type { PluginStatus } from '@/lib/game/types'
import { parseRubyMarshal, type RubyArray, type RubyValue, writeRubyMarshal } from '@/services/extract/lib/rgss/marshal'

import { readAceMember } from './rgss-archive'

const SOURCE = path.join(ROOT_PATH, 'plugins', 'rgss')
const NAME = 'ChayaRGSS'
const SCRIPT_PATH = 'chaya/plugins/rgss/Scripts.rvdata2'
const BOOTSTRAP = "load File.join(Dir.pwd, 'chaya', 'plugins', 'rgss', 'native.rb')\n"
const BUNDLE = [
  'preload.rb',
  'native.rb',
  'translation.rb',
  'translation_store.rb',
  'cache_json.rb',
  'bridge.rb',
  'native_webview.rb',
  'saves.rb',
  'map.rb',
  'user32.rb',
  'tktk_bitmap.rb',
  'asset_paths.rb',
  'font_fallback.rb',
  'script_patches.rb',
  'mouse_movement.rb',
]
const ASSETS = ['rgss-overlay.html', 'ChayaRGSSOverlay.js', 'libchaya-overlay.dylib']
const folder = (root: string) => path.join(root, 'chaya', 'plugins', 'rgss')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function atomicWrite(file: string, bytes: Uint8Array | string) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, bytes)
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function iniScripts(root: string) {
  const file = path.join(root, fs.readdirSync(root).find((name) => name.toLowerCase() === 'game.ini') ?? 'Game.ini')
  // Only change ASCII configuration syntax; preserve the game's title encoding.
  const text = fs.readFileSync(file).toString('latin1')
  const section = /^\[Game\][^\r\n]*(?:\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/im.exec(text)
  const match = section && /^[ \t]*Scripts[ \t]*=[^\r\n]*/im.exec(section[1])
  if (!section || !match) throw new Error('Game.ini is missing [Game] Scripts')
  const line = match[0]
  const script = line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replaceAll('\\', '/')
  if (!script || path.posix.isAbsolute(script) || script.split('/').includes('..') || script.includes(':')) throw new Error('Unsafe RGSS Scripts path')
  const offset = section.index + section[0].indexOf(section[1]) + match.index
  return { file, text, line, script, offset }
}

function setScripts(ini: ReturnType<typeof iniScripts>, line: string) {
  atomicWrite(ini.file, Buffer.from(ini.text.slice(0, ini.offset) + line + ini.text.slice(ini.offset + ini.line.length), 'latin1'))
}

type InstallState = { originalLine: string; originalScript: string; files: Record<string, string> }
function state(root: string): InstallState | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(folder(root), 'installed.json'), 'utf8')) as InstallState
    return typeof value.originalLine === 'string' &&
      /^[ \t]*Scripts[ \t]*=[^\r\n]+$/i.test(value.originalLine) &&
      typeof value.originalScript === 'string' &&
      !value.originalScript.includes(':') &&
      !value.originalScript.split(/[\\/]/).includes('..') &&
      !path.posix.isAbsolute(value.originalScript) &&
      value.files &&
      typeof value.files === 'object'
      ? value
      : null
  } catch {
    return null
  }
}

function readScripts(root: string, script: string) {
  const disk = path.join(root, ...script.split('/'))
  // A custom Scripts path outside the archive is what makes the installation
  // usable by stock Windows Game.exe without changing the encrypted archive.
  const archive = fs.readdirSync(root).find((name) => /^game\.rgss3a$/i.test(name))
  const packed = archive ? readAceMember(path.join(root, archive), script) : null
  if (packed) return packed
  if (fs.existsSync(disk)) return fs.readFileSync(disk)
  throw new Error('RGSS scripts not found; unpack VX encrypted scripts before installing the plugin')
}

function scriptsValue(bytes: Uint8Array): RubyArray {
  const value = parseRubyMarshal(bytes)
  if (!value || typeof value !== 'object' || value.kind !== 'array') throw new Error('Invalid RGSS script collection')
  return value
}

function entryText(value: RubyValue): { name: string; source: string } | null {
  if (!value || typeof value !== 'object' || value.kind !== 'array') return null
  const [, name, source] = value.items
  if (!name || typeof name !== 'object' || name.kind !== 'string' || !source || typeof source !== 'object' || source.kind !== 'string' || !source.bytes) return null
  return { name: name.value, source: inflateSync(source.bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8') }
}

function registered(root: string) {
  try {
    if (iniScripts(root).script !== SCRIPT_PATH) return false
    const scripts = scriptsValue(fs.readFileSync(path.join(root, SCRIPT_PATH)))
    return scripts.items.some((item) => {
      if (!item || typeof item !== 'object' || item.kind !== 'array') return false
      const name = item.items[1]
      if (!name || typeof name !== 'object' || name.kind !== 'string' || name.value !== NAME) return false
      return entryText(item)?.source === BOOTSTRAP
    })
  } catch {
    return false
  }
}

export function detectRgssPlugins(root: string): PluginStatus[] {
  const installed = state(root)
  const files =
    BUNDLE.every((name) => fs.existsSync(path.join(folder(root), name))) &&
    (process.platform !== 'darwin' || ASSETS.every((name) => fs.existsSync(path.join(folder(root), 'dist', name))))
  const enabled = !!installed && registered(root)
  return [{ name: NAME, registered: enabled, enabled, fileExists: files, kitSource: SOURCE }]
}

export function detectRgssPluginsOutdated(root: string): boolean {
  if (!state(root) || !registered(root)) return false
  return (
    BUNDLE.some((name) => {
      const source = path.join(SOURCE, name)
      const target = path.join(folder(root), name)
      return !fs.existsSync(source) || !fs.existsSync(target) || digest(fs.readFileSync(source)) !== digest(fs.readFileSync(target))
    }) ||
    ASSETS.some((name) => {
      const source = path.join(SOURCE, 'dist', name)
      const target = path.join(folder(root), 'dist', name)
      return fs.existsSync(source) && (!fs.existsSync(target) || digest(fs.readFileSync(source)) !== digest(fs.readFileSync(target)))
    })
  )
}

export function installRgssPlugins(root: string) {
  const ini = iniScripts(root)
  const previous = state(root)
  if (ini.script === SCRIPT_PATH && !previous) throw new Error('RGSS plugin install metadata is missing; restore the original Scripts setting before reinstalling')
  const originalLine = ini.script === SCRIPT_PATH ? previous!.originalLine : ini.line
  const originalScript = ini.script === SCRIPT_PATH ? previous!.originalScript : ini.script
  const scripts = scriptsValue(readScripts(root, originalScript))
  const entries = scripts.items.map(entryText)
  let main = entries.findLastIndex((entry) => entry && /^main$/i.test(entry.name.trim()))
  if (main < 0) main = entries.findLastIndex((entry) => entry && /^[ \t]*(?:SceneManager\.run\b|\$scene\s*=\s*Scene_Title\.new)/m.test(entry.source))
  if (main < 0) throw new Error('RGSS Main script not found; no game files were changed')
  const packed = deflateSync(BOOTSTRAP)
  scripts.items.splice(main, 0, { kind: 'array', items: [19773101, { kind: 'string', value: NAME }, { kind: 'string', value: packed.toString('utf8'), bytes: packed }] })
  // Validate all required sources before changing the game's configuration.
  const sources = BUNDLE.map((name) => ({ name, bytes: fs.readFileSync(path.join(SOURCE, name)) }))
  for (const name of ASSETS) {
    const file = path.join(SOURCE, 'dist', name)
    if (process.platform === 'darwin' || fs.existsSync(file)) sources.push({ name: `dist/${name}`, bytes: fs.readFileSync(file) })
  }
  const directory = folder(root)
  fs.mkdirSync(path.join(directory, 'dist'), { recursive: true })
  const files: Record<string, string> = {}
  for (const { name, bytes } of sources) {
    atomicWrite(path.join(directory, name), bytes)
    files[name] = digest(bytes)
  }
  atomicWrite(path.join(root, SCRIPT_PATH), writeRubyMarshal(scripts))
  atomicWrite(path.join(directory, 'installed.json'), JSON.stringify({ originalLine, originalScript, files } satisfies InstallState))
  const backup = `${ini.file}.chaya-plugins.bak`
  if (!fs.existsSync(backup)) fs.copyFileSync(ini.file, backup)
  setScripts(ini, `Scripts=${SCRIPT_PATH.replaceAll('/', '\\')}`)
  return { copied: sources.map(({ name }) => name), pluginsJsUpdated: ini.script !== SCRIPT_PATH, contentRoot: root }
}

export function clearRgssPlugins(root: string) {
  const installed = state(root)
  if (!installed) return { removedFiles: [], pluginsJsUpdated: false }
  const ini = iniScripts(root)
  if (ini.script === SCRIPT_PATH) setScripts(ini, installed.originalLine)
  const removedFiles: string[] = []
  for (const name of [...BUNDLE, ...ASSETS.map((name) => `dist/${name}`), 'installed.json', 'Scripts.rvdata2']) {
    const file = path.join(folder(root), name)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      removedFiles.push(name)
    }
  }
  return { removedFiles, pluginsJsUpdated: ini.script === SCRIPT_PATH }
}
