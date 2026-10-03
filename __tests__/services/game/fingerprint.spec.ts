import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveGame } from '@/lib/game'
import { getGameFingerprint, getGameFingerprintSummary } from '@/services/game/fingerprint'

let root: string
let content: string

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function resolved() {
  const result = resolveGame(root, root)
  if (!result.ok) throw new Error(result.error)
  return result
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-fingerprint-'))
  content = path.join(root, 'www')
  write(path.join(content, 'index.html'), '<html></html>')
  write(path.join(content, 'js', 'rmmz_core.js'), '// rmmz_core.js v1.8.0\nUtils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.8.0";')
  write(path.join(content, 'js', 'rmmz_managers.js'), '')
  write(path.join(content, 'js', 'libs', 'pixi.js'), '/*!\n * pixi.js - v5.3.12\n */')
  write(path.join(content, 'js', 'libs', 'effekseer.min.js'), '')
  write(
    path.join(content, 'js', 'plugins.js'),
    `var $plugins =\n${JSON.stringify([
      { name: 'VisuMZ_0_CoreEngine', status: true, description: '[Version 1.70]', parameters: { a: '1' } },
      { name: 'TextLog', status: false, description: '', parameters: {} },
      { name: 'Missing', status: true, description: '', parameters: {} },
      { name: 'ChayaLoader', status: true, description: '', parameters: {} },
    ])};`
  )
  write(
    path.join(content, 'js', 'plugins', 'VisuMZ_0_CoreEngine.js'),
    '/*:\n * @target MZ\n * @plugindesc [Version 1.70]\n * @author VisuStella\n */\nImported.VisuMZ_0_CoreEngine = true;'
  )
  write(path.join(content, 'js', 'plugins', 'TextLog.js'), '/*:ja\n * @author トリアコンタン\n * @version 1.2.0\n */')
  write(path.join(content, 'js', 'plugins', 'ChayaLoader.js'), '')
  write(path.join(content, 'data', 'System.json'), JSON.stringify({ gameTitle: 'Demo', locale: 'ja_JP', hasEncryptedImages: true, encryptionKey: 'k' }))
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', main: 'www/index.html', window: { title: 'Demo', width: 816, height: 624 } }))
  write(path.join(root, 'nw.dll'), '')
  write(path.join(root, 'Game.exe'), 'MZ-not-a-real-pe')
  const frameworks = path.join(root, 'Chaya.app', 'Contents', 'Frameworks', 'nwjs Framework.framework', 'Versions', '154.0.8037.58')
  fs.mkdirSync(frameworks, { recursive: true })
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

test('collects engine, plugins, system, package and shells from disk', () => {
  const fingerprint = getGameFingerprint(resolved())!
  expect(fingerprint.engine).toMatchObject({ name: 'MZ', version: '1.8.0', source: 'constant', coreFiles: ['rmmz_core.js', 'rmmz_managers.js'] })
  expect(fingerprint.engine.libs).toEqual(expect.arrayContaining([{ name: 'pixi.js', version: '5.3.12' }]))
  expect(fingerprint.system).toMatchObject({ gameTitle: 'Demo', locale: 'ja_JP', encryptedImages: true })
  expect(fingerprint.package).toMatchObject({ file: 'package.json', name: 'demo', title: 'Demo', width: 816 })
  expect(fingerprint.plugins.map((p) => [p.name, p.family, p.fileFound])).toEqual([
    ['VisuMZ_0_CoreEngine', 'VisuStella', true],
    ['TextLog', 'Triacontane', true],
    ['Missing', 'unknown', false],
    ['ChayaLoader', 'Chaya', true],
  ])
  expect(fingerprint.plugins[1]).toMatchObject({ version: '1.2.0', enabled: false })
  expect(fingerprint.shells).toEqual([
    { runtime: 'nwjs', platform: 'mac', path: 'Chaya.app', chromium: '154.0.8037.58', managed: true },
    { runtime: 'nwjs', platform: 'windows', path: 'Game.exe', chromium: null, managed: false },
  ])
})

test('summary for the library list', () => {
  expect(getGameFingerprintSummary(resolved())).toEqual({
    engine: 'MZ',
    engineVersion: '1.8.0',
    pluginCount: 3,
    enabledPluginCount: 2,
    topFamilies: ['Triacontane', 'VisuStella'],
    encrypted: true,
  })
})

test('reuses the cached result until watched files change', () => {
  const first = getGameFingerprint(resolved())
  expect(getGameFingerprint(resolved())).toBe(first)
  const pluginsJs = path.join(content, 'js', 'plugins.js')
  const later = new Date(Date.now() + 5_000)
  fs.utimesSync(pluginsJs, later, later)
  expect(getGameFingerprint(resolved())).not.toBe(first)
})
