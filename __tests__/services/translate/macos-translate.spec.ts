import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { PassThrough } from 'node:stream'

jest.mock('node:child_process', () => ({ spawn: jest.fn() }))

import { appleTranslator, toAppleLanguage } from '@/services/translate/lib/macos-translate'

describe('macos-translate', () => {
  it('maps language identifiers correctly', () => {
    expect(toAppleLanguage('ja', 'ja')).toBe('ja')
    expect(toAppleLanguage('zh', 'zh-Hans')).toBe('zh-Hans')
    expect(toAppleLanguage('zh-CN', 'zh-Hans')).toBe('zh-Hans')
    expect(toAppleLanguage('zh-TW', 'zh-Hans')).toBe('zh-Hant')
    expect(toAppleLanguage('cht', 'zh-Hans')).toBe('zh-Hant')
    expect(toAppleLanguage('pt-BR', 'pt-BR')).toBe('pt-BR')
    expect(toAppleLanguage('pt', 'pt-BR')).toBe('pt-BR')
    expect(toAppleLanguage(undefined, 'en')).toBe('en')
    expect(toAppleLanguage('unknown', 'ja')).toBe('unknown')
  })

  it('detects platform capability', () => {
    expect(typeof appleTranslator.isSupportedPlatform()).toBe('boolean')
  })

  it('handles empty text without calling daemon', async () => {
    const res = await appleTranslator.translate('')
    expect(res).toBe('')
    const resSpaces = await appleTranslator.translate('   ')
    expect(resSpaces).toBe('   ')
  })
})

describe('engine registration for apple', () => {
  it('includes apple in TRANSLATE_ENGINE_IDS', async () => {
    const { TRANSLATE_ENGINE_IDS, isBuiltinEngineId } = await import('@/lib/translate/engines')
    expect(TRANSLATE_ENGINE_IDS).toContain('apple')
    expect(isBuiltinEngineId('apple')).toBe(true)
  })

  it('normalizes apple engine in cacheEngineKind', async () => {
    const { cacheEngineKind, CACHE_ENGINE_KINDS } = await import('@/lib/translate/cache-engine-kind')
    expect(CACHE_ENGINE_KINDS).toContain('apple')
    expect(cacheEngineKind('apple')).toBe('apple')
    expect(cacheEngineKind('live:apple')).toBe('apple')
  })
})

describe('Apple native batch protocol', () => {
  let daemon: EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: jest.Mock }
  let requests: Array<{ id: string; type: string; items: Array<{ id: string; text: string }>; source: string }>
  beforeEach(() => {
    requests = []
    daemon = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: jest.fn() })
    daemon.stdin.on('data', (line: Buffer) => requests.push(JSON.parse(line.toString())))
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    jest.spyOn(fs, 'statSync').mockReturnValue({ ino: 1, size: 1, mtimeMs: 1 } as fs.Stats)
    jest.spyOn(appleTranslator, 'isSupportedPlatform').mockReturnValue(true)
    jest.mocked(spawn).mockReturnValue(daemon as unknown as ReturnType<typeof spawn>)
  })
  afterEach(() => appleTranslator.stopDaemon())
  const flush = async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }
  function respond(id: string, body: object) {
    daemon.stdout.write(JSON.stringify({ id, ...body }) + '\n')
  }
  it.each([
    ['translation_error', 'Unable to Translate', 'Unable to Translate'],
    ['not_installed', 'Language model supported but offline pack not installed', 'Apple offline language pack not installed.'],
  ])('reports %s without confusing translation failures with missing packs', async (code, message, expected) => {
    const result = expect(appleTranslator.translate('Hello', { source: 'en' })).rejects.toMatchObject({
      code,
      message: expect.stringContaining(expected),
    })
    await flush()
    respond(requests[0].items[0].id, { success: false, error: code, message })
    await result
  })
  it('sends one array, matches out-of-order IDs and isolates failed items', async () => {
    const trace = jest.fn()
    const results = Promise.allSettled(['Hello', 'Goodbye', 'Welcome'].map((text) => appleTranslator.translate(text, { source: 'en', onTrace: trace })))
    await flush()
    expect(requests).toHaveLength(1)
    expect(trace).toHaveBeenCalledTimes(1)
    expect(trace).toHaveBeenCalledWith('Apple request submitted: items=3, sourceChars=19')
    expect(requests[0]).toMatchObject({ type: 'batch', source: 'en', items: [{ text: 'Hello' }, { text: 'Goodbye' }, { text: 'Welcome' }] })
    const ids = requests[0].items.map((item) => item.id)
    respond(ids[2], { success: true, result: '欢迎' })
    respond(ids[0], { success: true, result: '你好' })
    respond(ids[1], { success: false, error: 'translation_error', message: 'Item failed' })
    expect(await results).toEqual([
      { status: 'fulfilled', value: '你好' },
      { status: 'rejected', reason: expect.objectContaining({ message: 'Item failed' }) },
      { status: 'fulfilled', value: '欢迎' },
    ])
  })
  it('keeps timing logs opt-in without changing translation results', async () => {
    const previous = process.env.CHAYA_TRANSLATE_DEBUG
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    try {
      delete process.env.CHAYA_TRANSLATE_DEBUG
      const first = appleTranslator.translate('Hello', { source: 'en' })
      await flush()
      respond(requests[0].items[0].id, { success: true, result: '你好' })
      expect(await first).toBe('你好')
      expect(info).not.toHaveBeenCalled()
      process.env.CHAYA_TRANSLATE_DEBUG = '1'
      const second = appleTranslator.translate('Welcome', { source: 'en' })
      await flush()
      respond(requests[1].items[0].id, { success: true, result: '欢迎' })
      expect(await second).toBe('欢迎')
      expect(info).toHaveBeenCalledWith(expect.stringContaining('[apple-timing] Batch dispatched:'))
    } finally {
      if (previous == null) delete process.env.CHAYA_TRANSLATE_DEBUG
      else process.env.CHAYA_TRANSLATE_DEBUG = previous
      info.mockRestore()
    }
  })
  it('splits language pairs, item limits and total character limits', async () => {
    const results = Promise.allSettled([
      ...Array.from({ length: 41 }, (_, i) => appleTranslator.translate(`Word${i}`, { source: 'en' })),
      appleTranslator.translate('こんにちは', { source: 'ja' }),
    ])
    await flush()
    expect(requests.map((request) => request.items.length)).toEqual([40, 1, 1])
    expect(requests.map((request) => request.source)).toEqual(['en', 'en', 'ja'])
    for (const request of requests) for (const item of request.items) respond(item.id, { success: true, result: '译文' })
    await results
    requests.length = 0
    const large = Promise.allSettled(Array.from({ length: 3 }, () => appleTranslator.translate('x'.repeat(20000))))
    await flush()
    expect(requests.map((request) => request.items.length)).toEqual([2, 1])
    for (const request of requests) for (const item of request.items) respond(item.id, { success: true, result: '译文' })
    await large
  })
  it('cancels outstanding native work without losing already returned items', async () => {
    const controller = new AbortController()
    const results = Promise.allSettled(['Hello', 'Welcome'].map((text) => appleTranslator.translate(text, { source: 'en', signal: controller.signal })))
    await flush()
    respond(requests[0].items[0].id, { success: true, result: '你好' })
    controller.abort(new Error('Batch deadline exceeded'))
    expect(await results).toEqual([
      { status: 'fulfilled', value: '你好' },
      { status: 'rejected', reason: expect.objectContaining({ message: 'Batch deadline exceeded' }) },
    ])
    expect(daemon.kill).toHaveBeenCalledTimes(1)
  })
  it('defers a binary upgrade until in-flight requests have settled', async () => {
    const first = appleTranslator.translate('Hello')
    await flush()
    jest.mocked(fs.statSync).mockReturnValue({ ino: 2, size: 2, mtimeMs: 2 } as fs.Stats)
    const second = appleTranslator.translate('Welcome')
    await flush()
    expect(daemon.kill).not.toHaveBeenCalled()
    for (const request of requests) for (const item of request.items) respond(item.id, { success: true, result: '你好' })
    await Promise.all([first, second])
    const third = appleTranslator.translate('Bye')
    await flush()
    expect(daemon.kill).toHaveBeenCalledTimes(1)
    respond(requests[2].items[0].id, { success: true, result: '再见' })
    expect(await third).toBe('再见')
    expect(spawn).toHaveBeenCalledTimes(2)
  })
  it('rejects only pending children on a batch-level error', async () => {
    const results = Promise.allSettled(['Hello', 'Bye'].map((text) => appleTranslator.translate(text)))
    await flush()
    respond(requests[0].items[0].id, { success: true, result: '你好' })
    respond(requests[0].id, { success: false, error: 'invalid_batch', message: 'Invalid translation batch' })
    expect(await results).toEqual([
      { status: 'fulfilled', value: '你好' },
      { status: 'rejected', reason: expect.objectContaining({ message: 'Invalid translation batch' }) },
    ])
  })
  it('rejects queued work when stopped before flush and never writes it', async () => {
    const results = Promise.allSettled([appleTranslator.translate('Hello')])
    appleTranslator.stopDaemon()
    await flush()
    expect(requests).toHaveLength(0)
    expect((await results)[0].status).toBe('rejected')
  })
  it('turns write failures into request rejections', async () => {
    jest.spyOn(daemon.stdin, 'write').mockImplementation(() => {
      throw new Error('Broken pipe')
    })
    const results = Promise.allSettled([appleTranslator.translate('Hello')])
    await flush()
    expect(await results).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: 'Broken pipe' }) }])
  })
})
