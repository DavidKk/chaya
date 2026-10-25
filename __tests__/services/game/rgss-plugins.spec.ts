import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

import { parseRubyMarshal, type RubyArray, type RubyString, writeRubyMarshal } from '@/services/extract/lib/rgss/marshal'
import {
  clearRgssPlugins,
  detectRgssPlugins,
  detectRgssPluginsOutdated,
  installRgssPlugins,
  listRgssPluginOutdatedFiles,
  RGSS_ASSET_FILES,
  RGSS_HOT_RELOAD_FILES,
  syncRgssHotReloadFiles,
} from '@/services/game/rgss-plugins'

jest.mock('@/constants/paths', () => ({ ...jest.requireActual('@/constants/paths'), ROOT_PATH: process.cwd() }))

let root: string
const script = (name: string, source: string): RubyArray => {
  const packed = deflateSync(source)
  return { kind: 'array', items: [1, { kind: 'string', value: name }, { kind: 'string', value: packed.toString('utf8'), bytes: packed }] }
}
const original = writeRubyMarshal({ kind: 'array', items: [script('Scene_End', 'def title; $scene = Scene_Title.new; end'), script('Main', 'SceneManager.run')] })
const ini = Buffer.concat([
  Buffer.from('[Game]\r\nTitle='),
  Buffer.from([0x82, 0xa0]),
  Buffer.from('\r\nScripts=Data\\Scripts.rvdata2\r\nLibrary=System\\RGSS301.dll\r\n[Other]\r\nKeep=yes\r\n'),
])

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-rgss-plugin-'))
  fs.mkdirSync(path.join(root, 'Data'))
  fs.writeFileSync(path.join(root, 'Game.ini'), ini)
  fs.writeFileSync(path.join(root, 'Data', 'Scripts.rvdata2'), original)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

it('installs a portable entry before Main, keeps originals and title encoding, and can uninstall', () => {
  expect(detectRgssPlugins(root)[0]).toMatchObject({ name: 'ChayaRGSS', registered: false, fileExists: false })
  installRgssPlugins(root)
  expect(fs.existsSync(path.join(root, 'chaya/plugins/rgss/edit_runtime.rb'))).toBe(true)
  expect(fs.existsSync(path.join(root, 'chaya/plugins/rgss/edit_actors.rb'))).toBe(true)
  expect(detectRgssPlugins(root)[0]).toMatchObject({ registered: true, fileExists: true })
  expect(detectRgssPluginsOutdated(root)).toBe(false)
  expect(fs.readFileSync(path.join(root, 'Data', 'Scripts.rvdata2'))).toEqual(Buffer.from(original))
  expect(fs.readFileSync(path.join(root, 'Game.ini.chaya-plugins.bak'))).toEqual(ini)
  expect(fs.readFileSync(path.join(root, 'Game.ini'))).toContain(0x82)
  const scripts = parseRubyMarshal(fs.readFileSync(path.join(root, 'chaya/plugins/rgss/Scripts.rvdata2'))) as RubyArray
  expect(scripts.items.map((s) => ((s as RubyArray).items[1] as RubyString).value)).toEqual(['Scene_End', 'ChayaRGSS', 'Main'])
  const bootstrap = inflateSync(((scripts.items[1] as RubyArray).items[2] as RubyString).bytes!).toString('utf8')
  expect(bootstrap).toContain("'native.rb'")
  // Verify Node-generated binary strings are actually readable by Ruby Marshal.
  expect(
    execFileSync('ruby', ['-rzlib', '-e', 'puts Marshal.load(File.binread(ARGV[0])).map{|s| s[1]}.join(",")', path.join(root, 'chaya/plugins/rgss/Scripts.rvdata2')], {
      encoding: 'utf8',
    }).trim()
  ).toBe('Scene_End,ChayaRGSS,Main')
  fs.appendFileSync(path.join(root, 'Game.ini'), 'NewSetting=kept\r\n')
  clearRgssPlugins(root)
  expect(fs.readFileSync(path.join(root, 'Game.ini'))).toEqual(Buffer.concat([ini, Buffer.from('NewSetting=kept\r\n')]))
  expect(detectRgssPlugins(root)[0].registered).toBe(false)
})

it('updates idempotently, detects missing/changed runtime files and registers only the correct loader', () => {
  installRgssPlugins(root)
  const bundle = path.join(root, 'chaya/plugins/rgss/translation.rb')
  fs.appendFileSync(bundle, '\n# changed')
  expect(detectRgssPluginsOutdated(root)).toBe(true)
  installRgssPlugins(root)
  expect(detectRgssPluginsOutdated(root)).toBe(false)
  const scripts = parseRubyMarshal(fs.readFileSync(path.join(root, 'chaya/plugins/rgss/Scripts.rvdata2'))) as RubyArray
  expect(scripts.items).toHaveLength(3)
  fs.unlinkSync(bundle)
  expect(detectRgssPlugins(root)[0].fileExists).toBe(false)
  fs.writeFileSync(path.join(root, 'Game.ini'), ini)
  expect(detectRgssPlugins(root)[0].registered).toBe(false)
})

it('fails before editing configuration when Main is absent or scripts are invalid', () => {
  fs.writeFileSync(path.join(root, 'Data/Scripts.rvdata2'), writeRubyMarshal({ kind: 'array', items: [script('Other', 'puts 1')] }))
  expect(() => installRgssPlugins(root)).toThrow('Main script not found')
  expect(fs.readFileSync(path.join(root, 'Game.ini'))).toEqual(ini)
  fs.writeFileSync(path.join(root, 'Data/Scripts.rvdata2'), 'corrupt')
  expect(() => installRgssPlugins(root)).toThrow()
  expect(fs.readFileSync(path.join(root, 'Game.ini'))).toEqual(ini)
})

it('uninstall leaves externally changed Scripts settings intact', () => {
  installRgssPlugins(root)
  fs.writeFileSync(path.join(root, 'Game.ini'), Buffer.from('[Game]\nScripts=Data\\Other.rvdata2\n'))
  clearRgssPlugins(root)
  expect(fs.readFileSync(path.join(root, 'Game.ini'), 'utf8')).toContain('Scripts=Data\\Other.rvdata2')
})

it('hot-syncs only bridge-reloadable Ruby without touching the entry script or overlay assets', () => {
  installRgssPlugins(root)
  const installed = path.join(root, 'chaya/plugins/rgss')
  const scripts = fs.readFileSync(path.join(installed, 'Scripts.rvdata2'))
  const assets = Object.fromEntries(RGSS_ASSET_FILES.map((name) => [name, fs.readFileSync(path.join(installed, 'dist', name))]))
  const reloadable = RGSS_HOT_RELOAD_FILES.find((name) => name === 'translation.rb')!
  fs.writeFileSync(path.join(installed, reloadable), 'stale')
  fs.writeFileSync(path.join(installed, 'preload.rb'), 'stale')
  expect(listRgssPluginOutdatedFiles(root)).toEqual(['preload.rb', reloadable])

  expect(syncRgssHotReloadFiles(root).copied).toEqual([reloadable])
  expect(fs.readFileSync(path.join(installed, reloadable), 'utf8')).toBe(fs.readFileSync(path.join('plugins/rgss', reloadable), 'utf8'))
  expect(fs.readFileSync(path.join(installed, 'preload.rb'), 'utf8')).toBe('stale')
  expect(fs.readFileSync(path.join(installed, 'Scripts.rvdata2'))).toEqual(scripts)
  for (const [name, bytes] of Object.entries(assets)) expect(fs.readFileSync(path.join(installed, 'dist', name))).toEqual(bytes)
  expect(listRgssPluginOutdatedFiles(root)).toEqual(['preload.rb'])
  expect(detectRgssPluginsOutdated(root)).toBe(true)
  installRgssPlugins(root)
  expect(detectRgssPluginsOutdated(root)).toBe(false)
})

it('hot-syncs a newly added Ruby dependency before translation.rb', () => {
  installRgssPlugins(root)
  const installed = path.join(root, 'chaya/plugins/rgss')
  fs.unlinkSync(path.join(installed, 'data_translation.rb'))
  fs.writeFileSync(path.join(installed, 'translation.rb'), 'stale')
  expect(syncRgssHotReloadFiles(root).copied).toEqual(['data_translation.rb', 'translation.rb'])
  expect(fs.readFileSync(path.join(installed, 'data_translation.rb'), 'utf8')).toBe(fs.readFileSync(path.join('plugins/rgss/data_translation.rb'), 'utf8'))
})
