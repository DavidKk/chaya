import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { GAME_CONTENT_RELS } from '@/lib/game/content-paths'
import { tryNodeFsPath } from '@/plugins/mv/src/helpers'
import { pluginStorageCall } from '@/plugins/mv/src/helpers/storage/client'
import { createRenderTranslation } from '@/plugins/mv/src/translator/engine/render-translation'

jest.mock('@/plugins/mv/src/helpers', () => ({
  createLogger: () => ({ info: jest.fn(), ok: jest.fn(), warn: jest.fn(), fail: jest.fn() }),
  detectGameIdentity: () => ({ contentRoot: '/game' }),
  tryNodeFsPath: jest.fn(),
}))
jest.mock('@/plugins/mv/src/helpers/storage/client', () => ({ pluginStorageCall: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers/plugin-tools', () => ({ declarePluginTools: jest.fn() }))
jest.mock('@/plugins/mv/src/translator/engine/engine-hooks', () => ({ installEngineHooks: () => jest.fn() }))
jest.mock('@/plugins/mv/src/translator/engine/dialogue-subtitles', () => ({ installDialogueSubtitles: jest.fn() }))
jest.mock('@/plugins/mv/src/translator/engine/subtitle-overlay', () => ({ installSubtitleOverlay: () => jest.fn() }))
jest.mock('@/plugins/mv/src/translator/engine/svg-image-text', () => ({ installSvgImageText: () => ({ refresh: jest.fn(), dispose: jest.fn() }) }))
jest.mock('@/plugins/mv/src/translator/engine/render-translation', () => ({
  createRenderTranslation: jest.fn(() => ({ observe: jest.fn(), subscribe: jest.fn(), dispose: jest.fn() })),
}))
jest.mock('@/plugins/mv/src/translator/engine/realtime-client', () => ({
  createRealtimeClient: () => ({ settings: () => ({ mode: 'realtime' }), dispose: jest.fn() }),
}))
jest.mock('@/plugins/mv/src/translator/patch/apply-queue', () => ({
  createTransCatchUp: () => ({ scheduleCatchUp: jest.fn(), scheduleWindowRefresh: jest.fn(), dispose: jest.fn() }),
}))

it('refreshes runtime aliases and immediately uses translations returned by realtime requests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-trans-review-'))
  const file = path.join(root, GAME_CONTENT_RELS.cacheNdjson)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ s: '\\V[3] is waiting.', t: '\\V[3]在等你。' }) + '\n')
  let name = 'Alice'
  const hot: { ChayaTrans?: { translate(text: string): string }; __chayaTransDispose?: () => void } = {}
  const globals = { window: hot, DataManager: { isDatabaseLoaded: () => true, onLoad: () => {} }, $gameVariables: { value: () => name } }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  jest.mocked(tryNodeFsPath).mockReturnValue({ fs, path })
  jest.mocked(pluginStorageCall).mockResolvedValue({ directory: root })
  try {
    await import('@/plugins/mv/src/translator')
    const translate = hot.ChayaTrans!.translate
    expect(translate('Alice is waiting.')).toBe('Alice在等你。')
    name = 'Bob'
    expect(translate('Alice is waiting.')).toBe('Alice is waiting.')
    expect(translate('Bob is waiting.')).toBe('Bob在等你。')
    expect(translate('こんにちは')).toBe('こんにちは')
    const options = jest.mocked(createRenderTranslation).mock.calls[0][0]
    options.apply('こんにちは', '你好')
    expect(translate('こんにちは')).toBe('你好')
  } finally {
    hot.__chayaTransDispose?.()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})
