import fs from 'node:fs'

import { GET, POST, PUT } from '@/app/api/integration/game-agent/route.server'
import * as ollamaClient from '@/services/game-agent/ollama-client'
import { GAME_AGENT_SETTINGS_PATH } from '@/services/game-agent/settings'
import { clearLaunchToken, issueLaunchToken } from '@/services/runtime/launch-token'

const ctx = { params: Promise.resolve({}) }
const url = 'http://localhost/api/integration/game-agent'

function request(method: string, token?: string, body?: unknown, headers?: HeadersInit) {
  const next = new Headers(headers)
  if (token) next.set('X-Chaya-Launch-Token', token)
  if (body !== undefined) next.set('Content-Type', 'application/json')
  return new Request(url, { method, headers: next, body: body === undefined ? undefined : JSON.stringify(body) })
}

beforeEach(() => {
  clearLaunchToken()
  fs.rmSync(GAME_AGENT_SETTINGS_PATH, { force: true })
})

afterEach(() => {
  clearLaunchToken()
  fs.rmSync(GAME_AGENT_SETTINGS_PATH, { force: true })
})

test('same-origin console access cannot read plugin-only settings', async () => {
  const response = await GET(request('GET'), ctx)
  expect(response.status).toBe(403)
  expect((await response.json()).error.code).toBe('GAME_AGENT_PLUGIN_ONLY')
})

test('management bearer cannot bypass the plugin launch token', async () => {
  const previous = process.env.CHAYA_AUTH_TOKEN
  process.env.CHAYA_AUTH_TOKEN = 'management-secret'
  try {
    const response = await GET(request('GET', undefined, undefined, { Authorization: 'Bearer management-secret' }), ctx)
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('GAME_AGENT_PLUGIN_ONLY')
  } finally {
    if (previous === undefined) delete process.env.CHAYA_AUTH_TOKEN
    else process.env.CHAYA_AUTH_TOKEN = previous
  }
})

test('valid plugin token can read, test, and save profiles', async () => {
  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  const initial = await GET(request('GET', token), ctx)
  expect(initial.status).toBe(200)
  expect((await initial.json()).settings.profiles[0]).not.toHaveProperty('online')

  jest.spyOn(ollamaClient, 'listOllamaModels').mockResolvedValue([{ name: 'demo-model' }])
  const profile = {
    id: 'ollama-office',
    label: 'Office Ollama',
    provider: 'ollama' as const,
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: 'demo-model',
    temperature: 0.3,
    keepAlive: '15m',
  }
  const tested = await POST(request('POST', token, { action: 'test', profile }), ctx)
  expect(tested.status).toBe(200)
  expect(await tested.json()).toMatchObject({ models: [{ name: 'demo-model' }], defaultModel: 'demo-model' })

  const saved = await PUT(request('PUT', token, { settings: { version: 1, defaultProfileId: profile.id, profiles: [profile] } }), ctx)
  expect(saved.status).toBe(200)
  expect((await saved.json()).settings).toMatchObject({ defaultProfileId: profile.id, profiles: [profile] })
})

test('unknown launch token is rejected before the route handler', async () => {
  const response = await GET(request('GET', 'not-issued', undefined, { Origin: 'https://example.test', 'Sec-Fetch-Site': 'cross-site' }), ctx)
  expect(response.status).toBe(401)
  expect((await response.json()).error.code).toBe('ACCESS_DENIED')
})
