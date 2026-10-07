import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { GET, PUT } from '@/app/api/input-assistance/global/route'
import type { InputAssistConfig, TurboRule } from '@/lib/game/input-assistance'

let dataDir = ''

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/lib/game/toolkit-data', () => ({ toolkitDataDir: () => dataDir }))

const ctx = { params: Promise.resolve({}) }
const q = { kind: 'key' as const, code: 'KeyQ', key: 'q', keyCode: 81 }

function turbo(patch: Partial<TurboRule> = {}): TurboRule {
  return { id: 't1', name: '连发', enabled: true, trigger: [q], originalInput: 'replace', kind: 'turbo', output: [q], interval: { minMs: 100, maxMs: 130 }, ...patch }
}

function put(config: unknown, expectedRevision = 0) {
  return PUT(new Request('http://localhost/api/input-assistance/global', { method: 'PUT', body: JSON.stringify({ config, expectedRevision }) }), ctx)
}

async function stored(): Promise<InputAssistConfig> {
  const response = await GET(new Request('http://localhost/api/input-assistance/global'), ctx)
  return (await response.json()).config
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-input-assist-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('starts empty and saves an enabled rule that is not configured yet', async () => {
  expect(await stored()).toEqual({ version: 1, revision: 0, rules: [] })
  const draft = turbo({ output: [], trigger: [] })
  const response = await put({ version: 1, revision: 1, rules: [draft] })
  expect(response.status).toBe(200)
  expect((await stored()).rules).toEqual([draft])
})

test('rejects a stale revision so two editors cannot overwrite each other', async () => {
  expect((await put({ version: 1, revision: 1, rules: [turbo()] })).status).toBe(200)
  const response = await put({ version: 1, revision: 1, rules: [] }, 0)
  expect(response.status).toBe(400)
  expect((await response.json()).error.code).toBe('REVISION_CONFLICT')
  expect((await stored()).rules).toHaveLength(1)
})

test('rejects configs containing invalid rules instead of silently dropping them', async () => {
  const response = await put({ version: 1, revision: 1, rules: [turbo({ interval: { minMs: 5, maxMs: 1 } })] })
  expect(response.status).toBe(400)
  expect((await stored()).rules).toEqual([])
})
