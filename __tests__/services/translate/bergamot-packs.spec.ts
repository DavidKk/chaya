import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BergamotPack, PackPlan } from '@/lib/translate/bergamot'
import { resolveBergamotBinary } from '@/services/translate/bergamot/binary'
import { findPack } from '@/services/translate/bergamot/catalog'
import { downloadPackFile, unpackFile } from '@/services/translate/bergamot/download'
import { packManager } from '@/services/translate/bergamot/manager'
import { validateBergamotPack } from '@/services/translate/bergamot/native'
import { installedPack } from '@/services/translate/bergamot/store'

jest.mock('@/services/translate/bergamot/catalog', () => ({ findPack: jest.fn(), bergamotPlatformSupported: () => true }))
jest.mock('@/services/translate/bergamot/binary', () => ({ resolveBergamotBinary: jest.fn() }))
jest.mock('@/services/translate/bergamot/native', () => ({ validateBergamotPack: jest.fn() }))
jest.mock('@/services/translate/bergamot/download', () => ({ ...jest.requireActual('@/services/translate/bergamot/download'), downloadPackFile: jest.fn(), unpackFile: jest.fn() }))

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const pack: BergamotPack = {
  id: 'en-zh',
  version: 'v1',
  source: 'en',
  target: 'zh',
  platforms: [],
  config: 'test-config',
  license: 'MPL-2.0',
  attribution: 'Mozilla',
  sample: { text: 'Hello', expected: '你好' },
  files: [{ name: 'model.bin', url: 'https://example.invalid/model.gz', bytes: 4, sha256: hash('gzip'), unpackedBytes: 5, unpackedSha256: hash('model') }],
}
let root: string
let previous: string | undefined
beforeEach(() => {
  previous = process.env.CHAYA_BERGAMOT_PACKS_DIR
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-pack-test-'))
  process.env.CHAYA_BERGAMOT_PACKS_DIR = root
  const binary = path.join(root, 'binary')
  fs.writeFileSync(binary, 'native')
  jest.mocked(resolveBergamotBinary).mockReturnValue(binary)
  jest.mocked(findPack).mockImplementation((from, to) => (from === 'en' && to === 'zh' ? pack : undefined))
  jest.mocked(validateBergamotPack).mockResolvedValue(undefined)
  jest.mocked(downloadPackFile).mockImplementation(async (_file, destination, signal, progress) => {
    signal.throwIfAborted()
    fs.writeFileSync(destination, 'gzip')
    progress(4)
  })
  jest.mocked(unpackFile).mockImplementation(async (_file, _archive, destination) => {
    fs.writeFileSync(destination, 'model')
  })
})
afterEach(() => {
  if (previous === undefined) delete process.env.CHAYA_BERGAMOT_PACKS_DIR
  else process.env.CHAYA_BERGAMOT_PACKS_DIR = previous
  fs.rmSync(root, { recursive: true, force: true })
})
async function terminal() {
  for (let i = 0; i < 200; i++) {
    const plan = await packManager().plan('en', 'zh')
    if (plan.job && ['completed', 'failed', 'cancelled'].includes(plan.job.state)) return plan
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Job did not finish')
}
async function install() {
  const plan = await packManager().plan('en', 'zh')
  await packManager().install('en', 'zh', plan.id)
  return terminal()
}
it('publishes only after validation, deduplicates installation, and detects file damage', async () => {
  let release!: () => void
  jest.mocked(downloadPackFile).mockImplementationOnce(async (_file, destination, _signal, progress) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    fs.writeFileSync(destination, 'gzip')
    progress(4)
  })
  const manager = packManager()
  const plan = await manager.plan('en', 'zh')
  const first = await manager.install('en', 'zh', plan.id)
  const duplicate = await manager.install('en', 'zh', plan.id)
  expect(duplicate.job?.id).toBe(first.job?.id)
  expect(installedPack('en', 'zh')).toBeUndefined()
  release()
  const completed = await terminal()
  expect(completed).toMatchObject({ installed: true, canInstall: false, job: { state: 'completed', downloadedBytes: 4 } })
  expect(validateBergamotPack).toHaveBeenCalled()
  fs.writeFileSync(path.join(installedPack('en', 'zh')!.root, 'en_zh/model.bin'), 'damaged')
  expect(await manager.plan('en', 'zh')).toMatchObject({ installed: false, canInstall: true })
})
it('repairs the same version in a new installation without replacing the old directory', async () => {
  await install()
  const old = installedPack('en', 'zh')!.root
  fs.writeFileSync(path.join(old, 'en_zh/model.bin'), 'damage')
  expect((await install()).installed).toBe(true)
  expect(installedPack('en', 'zh')!.root).not.toBe(old)
  expect(fs.readFileSync(path.join(old, 'en_zh/model.bin'), 'utf8')).toBe('damage')
})
it('never activates a model whose independent smoke test fails', async () => {
  jest.mocked(validateBergamotPack).mockRejectedValue(new Error('PACK_MODEL_INCOMPATIBLE'))
  expect(await install()).toMatchObject({ installed: false, job: { state: 'failed', error: 'PACK_MODEL_INCOMPATIBLE' } })
  expect(fs.existsSync(path.join(root, 'active/en-zh.json'))).toBe(false)
  expect(fs.existsSync(path.join(root, 'installer.lock'))).toBe(false)
})
it('cancels a running download and permits retry', async () => {
  jest.mocked(downloadPackFile).mockImplementationOnce(
    async (_file, _destination, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })
      })
  )
  const manager = packManager()
  const plan = await manager.plan('en', 'zh')
  const started = await manager.install('en', 'zh', plan.id)
  await manager.cancel('en', 'zh', started.job!.id)
  expect(await terminal()).toMatchObject({ installed: false, job: { state: 'cancelled' } })
  expect((await install()).installed).toBe(true)
})
it('rejects stale plans and a live installer owner', async () => {
  const manager = packManager()
  await expect(manager.install('en', 'zh', 'stale')).rejects.toThrow('PACK_PLAN_CHANGED')
  fs.writeFileSync(path.join(root, 'installer.lock'), JSON.stringify({ pid: process.pid }))
  const plan = await manager.plan('en', 'zh')
  await expect(manager.install('en', 'zh', plan.id)).rejects.toThrow('PACK_INSTALL_BUSY')
})
it('recovers an abandoned snapshot as interrupted and permits a fresh attempt', async () => {
  const manager = packManager()
  const plan = await manager.plan('en', 'zh')
  fs.mkdirSync(path.join(root, 'jobs'))
  fs.writeFileSync(
    path.join(root, 'jobs/abcdef.json'),
    JSON.stringify({ id: 'abcdef', planId: plan.id, source: 'en', target: 'zh', state: 'running', revision: 1, updatedAt: 1 } as PackPlan['job'])
  )
  expect((await manager.plan('en', 'zh')).job?.state).toBe('interrupted')
  expect((await install()).installed).toBe(true)
})
it('rejects a symlinked language directory', async () => {
  await install()
  const installed = installedPack('en', 'zh')!
  const folder = path.join(installed.root, 'en_zh')
  fs.renameSync(folder, folder + '-moved')
  fs.symlinkSync(folder + '-moved', folder)
  expect(installedPack('en', 'zh')).toBeUndefined()
})
