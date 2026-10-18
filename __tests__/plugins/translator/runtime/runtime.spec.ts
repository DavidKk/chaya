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
  const result = await runtime.translate(['こんにちは'], { interactive: true, engines: ['ollama'] })
  expect(result[0].zh).toBe('你好')
  expect(engineFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/chat', expect.objectContaining({ body: expect.stringContaining('mini-test') }))
  expect(fs.readFileSync(path.join(root, gameContentRelPath('cacheNdjson')), 'utf8')).toContain('你好')
  expect(jest.mocked(chayaFetch).mock.calls.every(([, init]) => ['lookup', 'translate-agents'].includes(JSON.parse(String(init?.body)).mode))).toBe(true)

  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  expect((await runtime.translate(['こんにちは'], { interactive: true }))[0]).toMatchObject({ zh: '你好', engine: 'cache:local' })
  expect(engineFetch).toHaveBeenCalledTimes(1)
  expect((await call('/api/translate', { mode: 'play-settings' })).data.settings).toMatchObject({ model: 'mini-test', mode: 'realtime' })
})

it('uses a remote hit without inference or an unversioned local copy', async () => {
  jest.mocked(chayaFetch).mockImplementation(async () => new Response(JSON.stringify({ available: true, items: [{ src: 'こんにちは', zh: '您好' }] })))
  expect((await runtime.translate(['こんにちは'], { interactive: true }))[0]).toMatchObject({ zh: '您好', engine: 'cache:remote' })
  expect(engineFetch).not.toHaveBeenCalled()
  expect(fs.existsSync(path.join(root, gameContentRelPath('cacheNdjson')))).toBe(false)
})

it('reuses inferred soft wraps while preserving word spaces and refreshing local values', async () => {
  const store = createTranslationStore(root, { fs, path }, () => {})
  await store.put([['来店\n　する', '走进店铺']])
  expect(store.lookup('来店する')).toBe('走进店铺')
  expect(store.lookup('来店\n　する')).toBe('走进店铺')
  await store.put([['来店\n　する', '进入店铺']])
  expect(store.lookup('来 店する')).toBeNull()
  expect(store.lookup('来店\n　する')).toBe('进入店铺')
  await store.put([['来店\n　する', null]])
  expect(store.lookup('来店する')).toBeNull()
})

it('reuses separately imported dialogue lines without calling a translation engine', async () => {
  await call('/api/translate-cache', {
    text: JSON.stringify({ '「セリカ様、': '「赛莉卡大人，', 'カウンター内は従業員以外立ち入り禁止ですよ」': '柜台后方禁止非工作人员进入哦」' }),
  })
  const source = '「セリカ様、\nカウンター内は従業員以外立ち入り禁止ですよ」'
  expect((await runtime.translate([source], { interactive: true, remote: false }))[0]).toMatchObject({
    zh: '「赛莉卡大人、\n柜台后方禁止非工作人员进入哦」',
    engine: 'cache:local',
  })
  expect(engineFetch).not.toHaveBeenCalled()
})

it('imports numbered-prefix and punctuation aliases and reuses them after restarting', async () => {
  const original = { M06_サブイベ1: 'M06_支线事件1', M06_サブイベ2: 'M06_支线事件2', M06_サブイベ3: 'M06_支线事件3', '受付係の！マーク消去': '接待员！标记消除' }
  await call('/api/translate-cache', { text: JSON.stringify(original) })
  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  const result = await runtime.translate(['サブイベ1', 'サブイベ2', 'サブイベ3', '受付係の！'], { interactive: true, remote: false, engines: [] })
  expect(result.map((item) => item.zh)).toEqual(['支线事件1', '支线事件2', '支线事件3', null])
  expect(result.slice(0, 3).every((item) => item.engine === 'cache:local')).toBe(true)
  expect(engineFetch).not.toHaveBeenCalled()
})

it('reuses complete body equivalence and assembled fragments before requesting engine translation', async () => {
  await call('/api/translate-cache', { text: JSON.stringify({ 'こんにちは，村へ行こう。': '你好，去村子吧。', 休もう: '休息吧', 準備を確認する: '确认准备情况' }) })
  const result = await runtime.translate(['「こんにちは\n村へ行こう！」', '「休もう、\n準備を確認する！」'], { interactive: true, remote: false, engines: [] })
  expect(result.map((item) => item.zh)).toEqual([null, '「休息吧、\n準備を確認する！」'])
  expect(result[1]).toMatchObject({ status: 'partial' })
  expect(result[1].plan?.gaps.map((gap) => gap.text)).toEqual(['準備を確認する！'])
  expect(engineFetch).not.toHaveBeenCalled()
})

it('translates complete color-separated dialogue locally while preserving every display instruction', async () => {
  await call('/api/translate-cache', { text: JSON.stringify({ 聖騎士団: '圣骑士团', 'へ行こう。': '去那里吧。', 王国軍: '王国军', を見よう: '看看吧' }) })
  const source = '「\\C[9]聖騎士団\\C[0]へ行こう。\n\\C[20]王国軍\\C[0]を見よう」'
  expect((await runtime.translate([source], { remote: false }))[0]).toMatchObject({ zh: '「\\C[9]圣骑士团\\C[0]去那里吧。\n\\C[20]王国军\\C[0]看看吧」', engine: 'cache:local' })
  expect(engineFetch).not.toHaveBeenCalled()
})

it('reuses orphan title boundaries and translated ruby fields from the imported game library', async () => {
  await call('/api/translate-cache', {
    text: JSON.stringify({ '品評会」開催当日': '品评会」举办当日', '「これは': '「这是', 認定: '认证', オーソライズ: '授权', 'です」': '哦」' }),
  })
  const items = await runtime.translate(['開催当日', String.raw`「これは\RB[認定,オーソライズ]です」`], { remote: false })
  expect(items.map((item) => item.zh)).toEqual(['開催当日', String.raw`「这是\RB[认证,授权]哦」`])
  expect(items.slice(1).every((item) => item.engine === 'cache:local')).toBe(true)
  expect(engineFetch).not.toHaveBeenCalled()
})

it('imports unchanged Han labels as translations and preserves them across restarts and export', async () => {
  const labels = { 第1部: '第1部', 第2部: '第2部', 第3部: '第3部' }
  expect((await call('/api/translate-cache', { text: JSON.stringify(labels) })).data.inserted).toBe(3)
  runtime.dispose()
  runtime = createTranslationRuntime(root, { mods: { fs, path } })
  expect((await runtime.translate(['第1部'], { interactive: true, remote: false }))[0]).toMatchObject({ zh: '第1部', engine: 'cache:local' })
  expect(engineFetch).not.toHaveBeenCalled()
  expect((await call('/api/translate-cache', undefined, 'GET')).data.items).toEqual(
    expect.arrayContaining(Object.keys(labels).map((src) => expect.objectContaining({ src, zh: src })))
  )
})

it('fills standalone Japanese game labels locally while preferring imported translations', async () => {
  const result = await runtime.translate(['炎', '剣', '銃', '槍'], { remote: false })
  expect(result.map((item) => item.zh)).toEqual(['炎', '剑', '枪', '长枪'])
  expect(result.every((item) => item.engine === 'builtin:terms')).toBe(true)
  expect(engineFetch).not.toHaveBeenCalled()
  await call('/api/translate-cache', { text: JSON.stringify({ 槍: '矛' }) })
  expect((await runtime.translate(['槍'], { remote: false }))[0]).toMatchObject({ zh: '矛', engine: 'cache:local' })
})

it('recognizes supported English and Korean term labels without using a translation engine', async () => {
  const result = await runtime.translate(['Sword', '검', '창'], { remote: false })
  expect(result.map((item) => item.zh)).toEqual(['剑', '剑', '长枪'])
  expect(result.every((item) => item.engine === 'builtin:terms')).toBe(true)
  expect(engineFetch).not.toHaveBeenCalled()
})

it('reuses valid paragraphs with shared Han words across indentation variants', async () => {
  const source = '「ほう、よくわかったな。\n　お前の想像通り、これは催眠魔法でな。\n　いつからだったか……、おいマキ、覚えてるか？」'
  const target = '「嚯，挺敏锐嘛。\n正如你所想，这是催眠魔法。\n从什么时候开始来着......喂真纪，还记得吗？」'
  await call('/api/translate-cache', { text: JSON.stringify({ [source]: target }) })
  const query = source.replace(/\u3000/g, '')
  expect((await runtime.translate([query], { interactive: true, remote: false, engines: [] }))[0].zh).toBe(target)
  expect((await runtime.translate(['いつからだったか……、おいマキ、覚えてるか？'], { interactive: true, remote: false, engines: [] }))[0].zh).toBeNull()
  expect(engineFetch).not.toHaveBeenCalled()
})

it('translates conditioned choices in both directions without sending conditions to an engine', async () => {
  await call('/api/translate-cache', { text: JSON.stringify({ 'en(s[1])様子を観察する': 'en(s[1])暗中观察' }) })
  expect((await runtime.translate(['en(!s[671])様子を観察する'], { interactive: true, remote: false }))[0]).toMatchObject({ zh: 'en(!s[671])暗中观察', engine: 'cache:local' })
  expect(engineFetch).not.toHaveBeenCalled()
  const guardSource = 'en(!s[671])村へ行くif(s[1])'
  expect((await runtime.translate([guardSource], { interactive: true, remote: false, engines: ['ollama'] }))[0].zh).toBe('en(!s[671])你好if(s[1])')
  const body = JSON.parse(String(jest.mocked(engineFetch).mock.calls[0][1]?.body))
  expect(body.messages[1].content).toBe('日文：\n村へ行く\n\n简体中文：')
})

it('does not send source text to the shared library in online game mode', async () => {
  const browser = globalThis as typeof globalThis & { window?: { CHAYA_LOG_TRANSPORT?: string } }
  const previousWindow = browser.window
  browser.window = { CHAYA_LOG_TRANSPORT: 'link' }
  try {
    const result = await runtime.translate(['こんにちは'], { interactive: true, engines: ['ollama'] })
    expect(result[0]).toMatchObject({ zh: '你好', engine: 'live:ollama' })
    expect(jest.mocked(chayaFetch).mock.calls.every(([, init]) => JSON.parse(String(init?.body)).mode === 'translate-agents')).toBe(true)
  } finally {
    if (previousWindow === undefined) delete browser.window
    else browser.window = previousWindow
  }
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
  await call('/api/translate', { mode: 'switches', switches: { bing: false, google: true }, order: ['google', 'bing'] })
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify([[['你好', 'こんにちは']]])))
  expect((await runtime.translate(['こんにちは'], { interactive: true, remote: false }))[0]).toMatchObject({ zh: '你好', engine: 'live:google' })
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '前面的森林有魔物，请在天黑前回村。' } })))
  expect((await call('/api/translate', { mode: 'benchmark' })).status).toBe(200)
  expect(jest.mocked(engineFetch).mock.calls[0][0]).toContain('translate.google.com')
  expect(jest.mocked(engineFetch).mock.calls[1][0]).toBe('http://127.0.0.1:11434/api/chat')
})

it('falls back to local inference when Cloud has no shared library and preserves choice conditions', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(new Response(JSON.stringify({ available: false, items: [] })))
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify({ message: { content: '前往村庄' } })))
  const src = '\\C[2]村へ行くif(s[1])'
  expect((await runtime.translate([src], { interactive: true, engines: ['ollama'] }))[0].zh).toBe('\\C[2]前往村庄if(s[1])')
  expect(JSON.parse(String(jest.mocked(engineFetch).mock.calls[0][1]?.body)).messages[1].content).toBe('日文：\n村へ行く\n\n简体中文：')
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
  await call('/api/translate', { mode: 'switches', switches: { bing: false, google: true } })
  jest.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify([[['你好', 'こんにちは']]])))
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
  expect((await call('/api/extract')).data.total).toBe(2)
  expect((await call('/api/extract', { export: true })).data.entries).toEqual({
    '街へ出かける\n準備を確認する': '',
    村へ戻る: '',
  })
  expect(JSON.parse(fs.readFileSync(path.join(root, gameContentRelPath('seed')), 'utf8'))).toEqual({
    '街へ出かける\n準備を確認する': '',
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

it('saves agent entries and translates through the local service', async () => {
  const saved = await call('/api/translate', {
    mode: 'switches',
    switches: { bing: false, google: false },
    agents: [{ id: 'a1', profileId: 'agent-1', model: 'qwen', enabled: true }],
  })
  expect(saved.data).toMatchObject({ enabled: ['agent:a1'], agents: [{ id: 'a1', profileId: 'agent-1', model: 'qwen', enabled: true }] })

  jest.mocked(chayaFetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.mode === 'ai') return new Response(JSON.stringify({ ok: true, text: '你好' }))
    return new Response(JSON.stringify({ available: true, items: [] }))
  })
  expect((await runtime.translate(['こんにちは'], { interactive: true }))[0]).toMatchObject({ zh: '你好', engine: 'live:agent:agent-1' })
  const aiCall = jest
    .mocked(chayaFetch)
    .mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    .find((b) => b.mode === 'ai')
  expect(aiCall).toEqual({ mode: 'ai', text: 'こんにちは', ai: { profileId: 'agent-1', model: 'qwen' }, interactive: true })
  expect(engineFetch).not.toHaveBeenCalled()
})

it('shares agent entries across games when the local service is up', async () => {
  const shared = { agents: [] as Array<Record<string, unknown>>, order: [] as string[], stored: false }
  jest.mocked(chayaFetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { mode?: string; agents?: unknown; order?: string[] }
    if (body.mode !== 'translate-agents') return new Response(JSON.stringify({ available: true, items: [] }))
    if (Array.isArray(body.agents) || Array.isArray(body.order)) {
      if (Array.isArray(body.agents)) shared.agents = body.agents as Array<Record<string, unknown>>
      if (Array.isArray(body.order)) shared.order = body.order
      shared.stored = true
    }
    return new Response(JSON.stringify({ ok: true, ...shared }))
  })
  await call('/api/translate', { mode: 'switches', agents: [{ id: 'a1', profileId: 'gpu', model: 'qwen', enabled: true }] })
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-other-game-'))
  const other = createTranslationRuntime(otherRoot, { mods: { fs, path } })
  try {
    const seen = await other.request({ path: '/api/translate', method: 'POST', body: { mode: 'switches' } })
    expect(seen.data).toMatchObject({ agents: [{ id: 'a1', profileId: 'gpu', model: 'qwen', enabled: true }] })
  } finally {
    other.dispose()
    fs.rmSync(otherRoot, { recursive: true, force: true })
  }
  const local = JSON.parse(fs.readFileSync(path.join(root, gameContentRelPath('switches')), 'utf8')) as { agents?: unknown }
  expect(local.agents).toBeUndefined()
})

it('can remove the last enabled engine', async () => {
  await call('/api/translate', { mode: 'switches', switches: { bing: false, google: false }, agents: [{ id: 'a1', profileId: 'p' }] })
  const res = await call('/api/translate', { mode: 'switches', agents: [] })
  expect(res.status).toBe(200)
  expect(res.data).toMatchObject({ agents: [], enabled: [] })
})

it('surfaces agent service errors per item', async () => {
  await call('/api/translate', { mode: 'switches', switches: { bing: false, google: false }, agents: [{ id: 'a1', profileId: 'p' }] })
  jest.mocked(chayaFetch).mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: { message: '没有可用的 Agent 实例' } }), { status: 500 }))
  expect((await runtime.translate(['こんにちは'], { remote: false }))[0]).toMatchObject({ zh: null, error: '没有可用的 Agent 实例' })
})

it('lists agent instances through the local service', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, profiles: [{ id: 'p', label: 'P', defaultModel: '' }], models: {} })))
  expect((await call('/api/translate', { mode: 'agents' })).data).toMatchObject({ ok: true, profiles: [{ id: 'p', label: 'P' }] })
  jest.mocked(chayaFetch).mockRejectedValue(new Error('Chaya 服务未启动'))
  expect((await call('/api/translate', { mode: 'agents' })).status).toBe(400)
})

it('refuses to start a batch job when every engine is off', async () => {
  fs.mkdirSync(path.join(root, 'data'))
  fs.writeFileSync(path.join(root, 'data', 'Map001.json'), JSON.stringify({ events: [null, { id: 1, pages: [{ list: [{ code: 401, parameters: ['こんにちは'] }] }] }] }))
  await call('/api/extract')
  expect((await call('/api/translate', { mode: 'switches', switches: { bing: false, google: false } })).status).toBe(200)
  const started = await call('/api/translate', { mode: 'job', action: 'start' })
  expect(started.status).toBe(400)
  expect(JSON.stringify(started.data)).toContain('未开启任何翻译平台')
})

it('exports translations from the game cache and leaves missing values empty', async () => {
  fs.mkdirSync(path.join(root, 'data'))
  fs.writeFileSync(
    path.join(root, 'data/CommonEvents.json'),
    JSON.stringify([{ id: 1, list: [{ code: 102, parameters: [[String.raw`\n\b「こんにちは。」`, '【こんにちは】', '待って？']] }] }])
  )
  expect((await call('/api/translate-cache', { text: JSON.stringify({ こんにちは: '你好', 'こんにちは。': '你好。', 別の文章: '其他文本' }) })).status).toBe(200)
  const exported = await call('/api/extract', { export: true })
  expect(exported.status).toBe(200)
  expect(exported.data.entries).toEqual({ '「こんにちは。」': '「你好。」', '【こんにちは】': '【你好】', '待って？': '' })
  expect(JSON.parse(fs.readFileSync(path.join(root, gameContentRelPath('seed')), 'utf8'))).toEqual({ こんにちは: '', 待って: '' })
})

it('imports raw paragraphs without materializing guessed sentence translations', async () => {
  const original = 'こんにちは，村へ行こう。'
  const imported = await call('/api/translate-cache', { text: JSON.stringify({ [original]: '你好，去村子吧。', '「村へ戻ろう」': '「回村子吧」' }) })
  expect(imported.status).toBe(200)
  const store = createTranslationStore(root, { fs, path })
  await store.load()
  expect(store.lookup(original)).toBe('你好，去村子吧。')
  expect(store.lookup('こんにちは')).toBeNull()
  expect(store.lookup('村へ行こう')).toBeNull()
  expect(store.lookup('「村へ戻ろう！」')).toBeNull()
  expect(store.lookup('村へ戻ろう')).toBe('回村子吧')
  await call('/api/translate-cache', { text: JSON.stringify({ 'こんにちは，休みましょう。': '您好，休息吧。' }) })
  await store.load()
  expect(store.lookup('こんにちは')).toBeNull()
})
