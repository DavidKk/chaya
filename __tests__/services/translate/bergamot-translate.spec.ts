import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { PassThrough } from 'node:stream'

import { findPack } from '@/services/translate/bergamot/catalog'
import { installedPack } from '@/services/translate/bergamot/store'
import { bergamotTranslator, toBergamotLanguage } from '@/services/translate/lib/bergamot-translate'

jest.mock('node:child_process', () => ({ spawn: jest.fn() }))
jest.mock('@/services/translate/bergamot/catalog', () => ({ findPack: jest.fn(() => ({ id: 'test-en-zh' })) }))
jest.mock('@/services/translate/bergamot/store', () => ({ installedPack: jest.fn() }))

function daemon() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    exitCode: null,
    kill: jest.fn(),
  })
}

let child: ReturnType<typeof daemon>
let platform: PropertyDescriptor | undefined

beforeEach(() => {
  jest.useFakeTimers()
  platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux' })
  jest.spyOn(fs, 'accessSync').mockImplementation(() => {})
  jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats)
  child = daemon()
  jest.mocked(spawn).mockImplementation(() => child as unknown as ReturnType<typeof spawn>)
})

afterEach(() => {
  bergamotTranslator.stopDaemon()
  jest.useRealTimers()
  if (platform) Object.defineProperty(process, 'platform', platform)
})

function sent() {
  return JSON.parse(child.stdin.read().toString()) as { id: string; action: string; from: string; to: string; text?: string }
}

function reply(response: unknown) {
  child.stdout.write(`${JSON.stringify(response)}\n`)
}

it.each([
  ['ch', 'zh'],
  ['zh-CN', 'zh'],
  ['zh-Hans', 'zh'],
  ['cht', 'zh-TW'],
  ['zh-Hant', 'zh-TW'],
  ['pt-BR', 'pt'],
])('maps %s to %s', (input, expected) => {
  expect(toBergamotLanguage(input, 'ja')).toBe(expected)
})

it('preserves blank input without spawning', async () => {
  await expect(bergamotTranslator.translate('  ')).resolves.toBe('  ')
  expect(spawn).not.toHaveBeenCalled()
})

it('uses JSON lines, maps languages, and reuses the daemon', async () => {
  const first = bergamotTranslator.translate('Hello\nworld', { source: 'en', target: 'cht' })
  const request = sent()
  expect(request).toMatchObject({ action: 'translate', from: 'en', to: 'zh-TW', text: 'Hello\nworld' })
  child.stdout.write('diagnostic\nnull\n[]\n')
  reply({ id: 'unknown', success: true, translatedText: 'ignored' })
  reply({ id: request.id, success: true, translatedText: '你好\n世界' })
  await expect(first).resolves.toBe('你好\n世界')
  const second = bergamotTranslator.translate('こんにちは')
  const next = sent()
  expect(next).toMatchObject({ from: 'ja', to: 'zh' })
  reply({ id: next.id, success: true, translatedText: '' })
  await expect(second).resolves.toBe('')
  expect(spawn).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(60_000)
  expect(child.kill).toHaveBeenCalled()
})

it('correlates concurrent replies by ID', async () => {
  const first = bergamotTranslator.translate('one')
  const firstId = sent().id
  const second = bergamotTranslator.translate('two')
  const secondId = sent().id
  reply({ id: secondId, success: true, translatedText: '二' })
  reply({ id: firstId, success: true, translatedText: '一' })
  await expect(Promise.all([first, second])).resolves.toEqual(['一', '二'])
})

it('rejects an explicit pack error', async () => {
  const result = bergamotTranslator.translate('Hello')
  reply({ id: sent().id, success: false, error: 'Language pack not installed' })
  await expect(result).rejects.toThrow('Language pack not installed')
})

it.each([true, false])('reports installed=%s through the check protocol', async (installed) => {
  const status = bergamotTranslator.checkStatus('en', 'zh')
  const request = sent()
  expect(request.action).toBe('check')
  reply({ id: request.id, success: true, installed })
  await expect(status).resolves.toMatchObject({ installed, status: installed ? 'ready' : 'model_pack_missing' })
})

it('returns unavailable when no executable exists', async () => {
  jest.spyOn(fs, 'accessSync').mockImplementation(() => {
    throw new Error('EACCES')
  })
  await expect(bergamotTranslator.checkStatus('en', 'zh')).resolves.toMatchObject({ installed: false, status: 'unavailable' })
  expect(spawn).not.toHaveBeenCalled()
})

it('does not use an installed English pack to report Japanese readiness', async () => {
  jest.mocked(findPack).mockReturnValueOnce(undefined)
  const status = await bergamotTranslator.checkEngineStatus('jp', 'zh')
  expect(status).toMatchObject({ source: 'ja', target: 'zh', installed: false, status: 'unsupported' })
  expect(installedPack).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

it('defaults checkEngineStatus to Japanese source language (ja -> zh)', async () => {
  jest.mocked(findPack).mockReturnValueOnce(undefined)
  const status = await bergamotTranslator.checkEngineStatus()
  expect(status).toMatchObject({ source: 'ja', target: 'zh', installed: false, status: 'unsupported' })
})

it('kills a hung daemon and ignores its late exit after restarting', async () => {
  const result = bergamotTranslator.translate('Hello')
  const rejected = expect(result).rejects.toThrow('5000ms')
  jest.advanceTimersByTime(5000)
  await rejected
  const previous = child
  expect(previous.kill).toHaveBeenCalledWith('SIGKILL')
  child = daemon()
  const restarted = bergamotTranslator.translate('Hello again')
  const request = sent()
  previous.emit('exit', null)
  reply({ id: request.id, success: true, translatedText: '你好' })
  await expect(restarted).resolves.toBe('你好')
})

it.each(['error', 'exit', 'stdin'])('rejects pending work on %s', async (event) => {
  const result = bergamotTranslator.translate('Hello')
  const rejected = expect(result).rejects.toThrow()
  if (event === 'stdin') child.stdin.emit('error', new Error('EPIPE'))
  else if (event === 'error') child.emit('error', new Error('ENOENT'))
  else child.emit('exit', 1)
  await rejected
})
