import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentRelPath } from '@/lib/game/content-paths'
import { chayaFetch } from '@/plugins/src/helpers/net/http'
import { createTranslationRuntime } from '@/plugins/src/translator/runtime'
import { engineFetch } from '@/plugins/src/translator/runtime/engine-fetch'
import { createTranslationStore } from '@/plugins/src/translator/runtime/store'

jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

jest.mock('@/plugins/src/helpers/net/http', () => ({ chayaFetch: jest.fn() }))
jest.mock('@/plugins/src/translator/runtime/engine-fetch', () => ({ engineFetch: jest.fn() }))

let root: string
let runtime: ReturnType<typeof createTranslationRuntime>
const call = (path: string, body?: Record<string, unknown>, method = 'POST') => runtime.request({ path, method, body })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-standalone-'))
  jest.mocked(chayaFetch).mockReset().mockRejectedValue(new Error('Chaya 服务未启动'))
  jest
    .mocked(engineFetch)
    .mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ message: { content: '你好' } })))
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
})
afterEach(() => {
  runtime.dispose()
  fs.rmSync(root, { recursive: true, force: true })
})

it('saves local settings, translates directly and preserves its library across restarts without a Chaya server', async () => {
  const saved = await call('/api/translate', { mode: 'play-settings', contentRoot: root, settings: { mode: 'realtime', model: 'mini-test', timeoutMs: 5000 } })
  expect(saved.status).toBe(200)
  const result = await runtime.translate(['こんにちは'], { interactive: true })
  expect(result[0].zh).toBe('你好')
  expect(engineFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/chat', expect.objectContaining({ body: expect.stringContaining('mini-test') }))
  expect(fs.readFileSync(path.join(root, gameContentRelPath('cacheNdjson')), 'utf8')).toContain('你好')
  expect(jest.mocked(chayaFetch).mock.calls.every(([, init]) => JSON.parse(String(init?.body)).mode === 'lookup')).toBe(true)

  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  expect((await runtime.translate(['こんにちは'], { interactive: true }))[0]).toMatchObject({ zh: '你好', engine: 'cache:local' })
  expect(engineFetch).toHaveBeenCalledTimes(1)
  expect((await call('/api/translate', { mode: 'play-settings' })).data.settings).toMatchObject({ model: 'mini-test', mode: 'realtime' })
})

it('uses a remote library hit without inference and persists it locally', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(new Response(JSON.stringify({ available: true, items: [{ src: 'こんにちは', zh: '您好' }] })))
  expect((await runtime.translate(['こんにちは'], { interactive: true }))[0]).toMatchObject({ zh: '您好', engine: 'cache:remote' })
  expect(engineFetch).not.toHaveBeenCalled()
  expect(fs.readFileSync(path.join(root, gameContentRelPath('cacheNdjson')), 'utf8')).toContain('您好')
})

it('does not store an unchanged or partially untranslated model response', async () => {
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '你好、こんにちは' } })))
  const result = await runtime.translate(['こんにちは'], { interactive: true, remote: false, engines: ['ollama'] })
  expect(result[0].zh).toBeNull()
  expect(fs.existsSync(path.join(root, gameContentRelPath('cacheNdjson')))).toBe(false)

  const invalidImport = await call('/api/translate-cache', { text: JSON.stringify({ こんにちは: '你好、こんにちは' }) })
  expect(invalidImport.status).toBe(400)
  expect((await call('/api/translate-cache', { src: 'こんにちは', zh: 'こんにちは' }, 'PATCH')).status).toBe(400)
})

it('uses enabled platforms for dialogue but always benchmarks the local model', async () => {
  await call('/api/translate', { mode: 'switches', switches: { ollama: false, bing: false, google: true }, order: ['google', 'bing', 'ollama'] })
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify([[['你好', 'こんにちは']]])))
  expect((await runtime.translate(['こんにちは'], { interactive: true, remote: false }))[0]).toMatchObject({ zh: '你好', engine: 'live:google' })
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '前面的森林有魔物，请在天黑前回村。' } })))
  expect((await call('/api/translate', { mode: 'benchmark' })).status).toBe(200)
  expect(jest.mocked(engineFetch).mock.calls[0][0]).toContain('translate.google.com')
  expect(jest.mocked(engineFetch).mock.calls[1][0]).toBe('http://127.0.0.1:11434/api/chat')
})

it('falls back to local inference when Edge has no shared library and preserves choice conditions', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(new Response(JSON.stringify({ available: false, items: [] })))
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '前往村庄' } })))
  const src = '\\C[2]村へ行くif(s[1])'
  expect((await runtime.translate([src], { interactive: true }))[0].zh).toBe('\\C[2]前往村庄if(s[1])')
  expect(JSON.parse(String(jest.mocked(engineFetch).mock.calls[0][1]?.body)).messages[1].content).toBe('村へ行く')
})

it('does not persist or display a cancelled late model response', async () => {
  let finish!: (response: Response) => void
  let started!: () => void
  const start = new Promise<void>((resolve) => {
    started = resolve
  })
  jest.mocked(engineFetch).mockImplementation(async () => {
    started()
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const abort = new AbortController()
  const request = runtime.translate(['こんにちは'], { interactive: true, remote: false, signal: abort.signal })
  const rejected = expect(request).rejects.toBeDefined()
  await start
  abort.abort()
  finish(new Response(JSON.stringify({ message: { content: '旧对话译文' } })))
  await rejected
  expect(fs.existsSync(path.join(root, gameContentRelPath('cacheNdjson')))).toBe(false)
})

it('extracts locally, runs a plugin-owned job and supports import/edit/delete without disk HTTP APIs', async () => {
  fs.mkdirSync(path.join(root, 'data'))
  fs.writeFileSync(path.join(root, 'data', 'Map001.json'), JSON.stringify({ events: [null, { id: 1, pages: [{ list: [{ code: 401, parameters: ['こんにちは'] }] }] }] }))
  expect((await call('/api/extract')).data.total).toBe(1)
  expect((await call('/api/translate', { mode: 'progress' })).data.missing).toBe(1)
  expect((await call('/api/translate', { mode: 'job', action: 'start' })).status).toBe(200)
  for (let i = 0; i < 100; i++) {
    const snapshot = await call('/api/translate', { mode: 'progress' })
    if ((snapshot.data.job as { status: string }).status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect((await call('/api/translate', { mode: 'progress' })).data).toMatchObject({ done: 1, missing: 0, job: { status: 'done' } })
  expect((await call('/api/translate-cache', { text: JSON.stringify({ 村へ行こう: '去村子吧' }) })).data.inserted).toBe(1)
  expect((await call('/api/translate-cache', { src: '村へ行こう', zh: '前往村子' }, 'PATCH')).status).toBe(200)
  expect((await call('/api/translate-cache?q=村', undefined, 'GET')).data.items).toEqual([expect.objectContaining({ zh: '前往村子' })])
  expect((await call('/api/translate-cache', { src: '村へ行こう' }, 'DELETE')).status).toBe(200)
  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  expect((await call('/api/translate-cache?q=村', undefined, 'GET')).data.total).toBe(0)
})

it('rejects arbitrary paths and stale-game settings writes', async () => {
  expect((await call('/api/shell', { action: 'install' })).status).toBe(400)
  expect((await call('/api/translate', { mode: 'play-settings', contentRoot: '/other-game', settings: { mode: 'realtime' } })).status).toBe(400)
})

it('extracts MPP choice-help comments into the game library without importing ordinary developer comments', async () => {
  fs.mkdirSync(path.join(root, 'data'))
  fs.writeFileSync(
    path.join(root, 'data', 'CommonEvents.json'),
    JSON.stringify([
      null,
      {
        id: 1,
        list: [
          { code: 108, parameters: ['選択肢ヘルプ'] },
          { code: 408, parameters: ['街へ出かける'] },
          { code: 408, parameters: ['準備を確認する'] },
          { code: 0, parameters: [] },
          { code: 108, parameters: ['開発用メモ'] },
          { code: 408, parameters: ['翻訳してはいけない注釈'] },
          { code: 108, parameters: ['<ChoiceHelp>'] },
          { code: 408, parameters: ['村へ戻る'] },
        ],
      },
    ])
  )
  expect((await call('/api/extract')).data.total).toBe(3)
  expect(JSON.parse(fs.readFileSync(path.join(root, gameContentRelPath('seed')), 'utf8'))).toEqual({
    街へ出かける: '',
    準備を確認する: '',
    村へ戻る: '',
  })
})

it('reads a legacy final row without a newline and preserves it when appending', async () => {
  const file = path.join(root, gameContentRelPath('cacheNdjson'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ s: 'こんにちは', t: '您好' }))
  expect((await runtime.translate(['こんにちは'], { remote: false }))[0].zh).toBe('您好')
  expect(engineFetch).not.toHaveBeenCalled()
  await call('/api/translate-cache', { src: '村へ行こう', zh: '去村子吧' }, 'PATCH')
  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  expect((await call('/api/translate-cache', undefined, 'GET')).data.total).toBe(2)
})

it('re-reads an incomplete UTF-8 tail once the remaining bytes arrive', async () => {
  const file = path.join(root, gameContentRelPath('cacheNdjson'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const encoded = Buffer.from(JSON.stringify({ s: 'こんにちは', t: '您好' }) + '\n')
  const cut = encoded.indexOf(Buffer.from('您好')) + 1
  fs.writeFileSync(file, encoded.subarray(0, cut))
  const store = createTranslationStore(root, { fs, path }, () => {})
  await store.load()
  expect(store.lookup('こんにちは')).toBeNull()
  fs.appendFileSync(file, encoded.subarray(cut))
  await store.load()
  expect(store.lookup('こんにちは')).toBe('您好')
})

it('loads an existing Chinese translation that preserves Japanese punctuation', async () => {
  const file = path.join(root, gameContentRelPath('cacheNdjson'))
  const src = '・1時間あたりの睡眠で\\c[18]スタミナ10回復\\c[0]します。'
  const zh = '・每个小时的睡眠都会恢复\\c[18]10耐力\\c[0]。'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ s: src, t: zh }) + '\n')
  expect((await runtime.translate([src], { remote: false }))[0]).toMatchObject({ zh, engine: 'cache:local' })
  expect(engineFetch).not.toHaveBeenCalled()
})

it('ignores a historical half-translated kanji phrase and translates it again', async () => {
  const file = path.join(root, gameContentRelPath('cacheNdjson'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ s: '応接室へ行く', t: '去応接室' }) + '\n')
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '去会客室' } })))
  const item = (await runtime.translate(['応接室へ行く'], { remote: false, engines: ['ollama'] }))[0]
  expect(item).toMatchObject({ zh: '去会客室', engine: 'live:ollama' })
  expect(engineFetch).toHaveBeenCalledTimes(1)
})

it('exposes recent in-game dialogue activity to the translation panel', async () => {
  runtime.recordActivity({ level: 'info', text: '翻译中：応接室へ行く', status: '翻译中' })
  runtime.recordActivity({ level: 'warn', text: '未得到有效译文：応接室へ行く', status: '未译' })
  const response = await call('/api/translate', { mode: 'progress' })
  expect(response.data.activity).toMatchObject({
    liveStatus: '未译',
    sessionDone: 0,
    logs: [expect.objectContaining({ text: '翻译中：応接室へ行く' }), expect.objectContaining({ text: '未得到有效译文：応接室へ行く' })],
  })
})
