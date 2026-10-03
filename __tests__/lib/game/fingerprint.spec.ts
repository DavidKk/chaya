import {
  buildPluginInfo,
  chromiumFromFrameworkVersions,
  detectEngine,
  parseCoreScript,
  parseLibVersion,
  parsePluginHeader,
  parseSystemJson,
  plistString,
  pluginFamily,
  pluginStats,
  readPeVersion,
  summarizeFingerprint,
  topThirdPartyFamilies,
} from '@/lib/game/fingerprint'

describe('engine detection', () => {
  test('reads MZ constants from rmmz_core.js', () => {
    const source = '//====\n// rmmz_core.js v1.8.0\n//====\nUtils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.8.0";'
    expect(parseCoreScript(source)).toEqual({ name: 'MZ', version: '1.8.0', source: 'constant' })
  })

  test('reads MV constants with single quotes', () => {
    expect(parseCoreScript('Utils.RPGMAKER_NAME = \'MV\';\nUtils.RPGMAKER_VERSION = "1.6.1";')).toEqual({ name: 'MV', version: '1.6.1', source: 'constant' })
  })

  test('falls back to the core file header comment', () => {
    expect(parseCoreScript('// rpg_core.js v1.0.0\nfunction JsExtensions() {}')).toEqual({ name: 'MV', version: '1.0.0', source: 'header' })
  })

  test('uses file names when the core script has no version', () => {
    const engine = detectEngine({ jsFiles: ['main.js', 'rpg_core.js', 'rpg_managers.js', 'plugins.js'], coreSource: 'var x = 1' })
    expect(engine).toMatchObject({ name: 'MV', version: null, source: 'files', coreFiles: ['rpg_core.js', 'rpg_managers.js'] })
  })

  test('guesses from libraries when core scripts are bundled away', () => {
    expect(detectEngine({ jsFiles: ['main.js'], libs: [{ name: 'effekseer.min.js', version: null }] }).name).toBe('MZ')
    expect(detectEngine({ jsFiles: ['main.js'], libs: [{ name: 'pixi.js', version: '4.5.4' }] }).name).toBe('MV')
    expect(detectEngine({ jsFiles: ['game.js'] })).toMatchObject({ name: 'unknown', source: 'none' })
  })

  test('reads library versions from file headers', () => {
    expect(parseLibVersion('/*!\n * pixi.js - v5.3.12\n */')).toBe('5.3.12')
    expect(parseLibVersion('no version here')).toBeNull()
  })
})

describe('plugin header', () => {
  const visu = `//=====
// VisuStella MZ - Message Core
//=====
var Imported = Imported || {};
Imported.VisuMZ_1_MessageCore = true;
var VisuMZ = VisuMZ || {};
VisuMZ.MessageCore.version = 1.46;
/*:
 * @target MZ
 * @plugindesc [RPG Maker MZ] [Tier 1] [Version 1.46] [MessageCore]
 * @author VisuStella
 * @url http://www.yanfly.moe/wiki/Message_Core_VisuStella_MZ
 * @base VisuMZ_0_CoreEngine
 * @orderAfter VisuMZ_0_CoreEngine
 */
/*:ja
 * @plugindesc 日本語の説明
 */`

  test('parses tags from the default-language block', () => {
    expect(parsePluginHeader(visu)).toEqual({
      author: 'VisuStella',
      plugindesc: '[RPG Maker MZ] [Tier 1] [Version 1.46] [MessageCore]',
      target: ['MZ'],
      version: '1.46',
      url: 'http://www.yanfly.moe/wiki/Message_Core_VisuStella_MZ',
      base: ['VisuMZ_0_CoreEngine'],
      imported: ['VisuMZ_1_MessageCore'],
    })
  })

  test('falls back to a localized block and code version', () => {
    const header = parsePluginHeader('/*:ja\n * @plugindesc 説明\n * @author トリアコンタン\n */\nTri.version = "2.3.1";')
    expect(header).toMatchObject({ author: 'トリアコンタン', plugindesc: '説明', version: '2.3.1', target: [] })
  })

  test('splits multi-target values', () => {
    expect(parsePluginHeader('/*:\n * @target MV MZ\n */').target).toEqual(['MV', 'MZ'])
  })
})

describe('plugin family', () => {
  test.each([
    ['VisuMZ_1_MessageCore', undefined, 'VisuStella'],
    ['YEP_MessageCore', undefined, 'Yanfly'],
    ['ChayaTrans', undefined, 'Chaya'],
    ['Community_Basic', undefined, 'RPG Maker'],
    ['SomePlugin', 'Yoji Ojima', 'RPG Maker'],
    ['TextLog', 'トリアコンタン', 'Triacontane'],
    ['MyPlugin', 'Alice (https://example.com)', 'Alice'],
    ['Anon', undefined, 'unknown'],
  ])('%s by %s → %s', (name, author, family) => {
    expect(pluginFamily(name, author)).toBe(family)
  })

  test('stats and top families skip Chaya, official and unknown', () => {
    const plugins = [
      buildPluginInfo({ name: 'VisuMZ_0_CoreEngine', status: true }, '/*:\n * @author VisuStella\n */'),
      buildPluginInfo({ name: 'VisuMZ_1_MessageCore', status: false }, null),
      buildPluginInfo({ name: 'YEP_CoreEngine', status: true, parameters: { a: '1', b: '2' } }, ''),
      buildPluginInfo({ name: 'Community_Basic', status: true }, ''),
      buildPluginInfo({ name: 'ChayaTrans', status: true }, ''),
      buildPluginInfo({ name: 'Anon', status: true }, ''),
    ]
    const stats = pluginStats(plugins)
    expect(stats).toMatchObject({ total: 6, enabled: 5, missingFiles: 1 })
    expect(stats.families[0]).toEqual({ family: 'VisuStella', count: 2 })
    expect(topThirdPartyFamilies(stats)).toEqual(['VisuStella', 'Yanfly'])
    expect(plugins[2]).toMatchObject({ paramCount: 2, fileFound: true })
    expect(plugins[4]).toMatchObject({ chaya: true, family: 'Chaya' })
  })
})

describe('shell versions', () => {
  test('framework version directory', () => {
    expect(chromiumFromFrameworkVersions(['Current', '154.0.8037.58'])).toBe('154.0.8037.58')
    expect(chromiumFromFrameworkVersions(['A', 'Current'])).toBeNull()
  })

  test('XML plist string', () => {
    expect(plistString('<dict><key>CFBundleShortVersionString</key>\n<string>154.0.8037.58</string></dict>', 'CFBundleShortVersionString')).toBe('154.0.8037.58')
    expect(plistString('bplist00…', 'CFBundleShortVersionString')).toBeNull()
  })

  function utf16(text: string): number[] {
    return Array.from(text).flatMap((ch) => [ch.charCodeAt(0), 0])
  }

  function fakePe(product: string): Uint8Array {
    const bytes = new Uint8Array(0x200)
    bytes.set([0x4d, 0x5a])
    bytes.set([0x40, 0, 0, 0], 0x3c)
    bytes.set([0x50, 0x45, 0, 0], 0x40)
    bytes.set([1, 0], 0x46) // one section
    bytes.set([0, 0], 0x54) // no optional header
    bytes.set(
      utf16('.rsrc').filter((_, i) => i % 2 === 0),
      0x58
    )
    const rsrc = [...utf16('FileVersion'), 0, 0, 0, 0, ...utf16('1.2.3.4'), 0, 0, ...utf16('ProductVersion'), 0, 0, 0, 0, ...utf16(product), 0, 0]
    bytes.set([rsrc.length & 0xff, rsrc.length >> 8, 0, 0], 0x58 + 16)
    bytes.set([0x00, 0x01, 0, 0], 0x58 + 20)
    bytes.set(rsrc, 0x100)
    return bytes
  }

  test('PE ProductVersion from the resource section', () => {
    const pe = fakePe('154.0.8037.58')
    expect(readPeVersion((offset, length) => pe.subarray(offset, offset + length))).toEqual({ productVersion: '154.0.8037.58', fileVersion: '1.2.3.4' })
  })

  test('non-PE files return null', () => {
    const text = new TextEncoder().encode('#!/bin/sh\n'.padEnd(128, ' '))
    expect(readPeVersion((offset, length) => text.subarray(offset, offset + length))).toBeNull()
  })
})

describe('system and summary', () => {
  test('System.json keeps flags but never the key', () => {
    const system = parseSystemJson({
      gameTitle: '勇者',
      locale: 'ja_JP',
      versionId: 42,
      hasEncryptedImages: true,
      encryptionKey: 'secret',
      advanced: { screenWidth: 816, screenHeight: 624 },
    })
    expect(system).toEqual({ gameTitle: '勇者', locale: 'ja_JP', versionId: 42, encryptedImages: true, encryptedAudio: false, screenWidth: 816, screenHeight: 624 })
    expect(JSON.stringify(system)).not.toContain('secret')
  })

  test('summary counts only third-party plugins', () => {
    const plugins = [buildPluginInfo({ name: 'YEP_CoreEngine', status: true }, ''), buildPluginInfo({ name: 'ChayaTrans', status: true }, '')]
    const summary = summarizeFingerprint({
      engine: { name: 'MV', version: '1.6.2', source: 'constant', coreFiles: [], libs: [] },
      system: { encryptedImages: false, encryptedAudio: true },
      package: null,
      shells: [],
      plugins,
      pluginStats: pluginStats(plugins),
      collectedAt: 0,
    })
    expect(summary).toEqual({ engine: 'MV', engineVersion: '1.6.2', pluginCount: 1, enabledPluginCount: 1, topFamilies: ['Yanfly'], encrypted: true })
  })
})
