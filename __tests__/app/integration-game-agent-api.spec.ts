import fs from 'node:fs'

import { GET, POST, PUT } from '@/app/api/integration/game-agent/route.server'
import { applySettingsToAgentSyncDocument, createEmptyAgentSyncDocument, withAgentSyncActor } from '@/lib/game-agent/settings-sync'
import * as ollamaClient from '@/services/game-agent/ollama-client'
import { GAME_AGENT_SETTINGS_PATH, GAME_AGENT_SYNC_PATH } from '@/services/game-agent/settings'
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
  fs.rmSync(GAME_AGENT_SYNC_PATH, { force: true })
})

afterEach(() => {
  clearLaunchToken()
  fs.rmSync(GAME_AGENT_SETTINGS_PATH, { force: true })
  fs.rmSync(GAME_AGENT_SYNC_PATH, { force: true })
})

test('same-origin console can read shared Agent settings', async () => {
  const response = await GET(request('GET'), ctx)
  expect(response.status).toBe(200)
  expect((await response.json()).settings.profiles).toHaveLength(1)
})

test('management bearer can read shared Agent settings', async () => {
  const previous = process.env.CHAYA_AUTH_TOKEN
  process.env.CHAYA_AUTH_TOKEN = 'management-secret'
  try {
    const response = await GET(request('GET', undefined, undefined, { Authorization: 'Bearer management-secret' }), ctx)
    expect(response.status).toBe(200)
    expect((await response.json()).settings.profiles).toHaveLength(1)
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

test('empty plugin initialization preserves service Agents', async () => {
  const initial = await GET(request('GET'), ctx)
  const current = await initial.json()
  const second = { ...current.settings.profiles[0], id: 'office', label: 'Office Ollama' }
  await PUT(request('PUT', undefined, { settings: { ...current.settings, profiles: [...current.settings.profiles, second] } }), ctx)

  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  const synced = await PUT(request('PUT', token, { sync: createEmptyAgentSyncDocument('plugin:test') }), ctx)
  expect((await synced.json()).settings.profiles.map((profile: { id: string }) => profile.id)).toEqual(['ollama-local', 'office'])
})

test('plugin and service edits to different fields are both retained', async () => {
  const initial = await GET(request('GET'), ctx)
  const body = await initial.json()
  const pluginBase = withAgentSyncActor(body.sync, 'plugin:test')
  const pluginSettings = {
    ...body.settings,
    profiles: [{ ...body.settings.profiles[0], label: 'In-game Ollama' }],
  }
  const pluginChange = applySettingsToAgentSyncDocument(pluginBase, pluginSettings)

  const serviceSettings = {
    ...body.settings,
    profiles: [{ ...body.settings.profiles[0], defaultModel: 'service-model' }],
  }
  await PUT(request('PUT', undefined, { settings: serviceSettings }), ctx)

  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  const synced = await PUT(request('PUT', token, { sync: pluginChange }), ctx)
  expect((await synced.json()).settings.profiles[0]).toMatchObject({ label: 'In-game Ollama', defaultModel: 'service-model' })
})

test('a stale service form does not delete an Agent added by the plugin', async () => {
  const initial = await GET(request('GET'), ctx)
  const baseline = await initial.json()
  const pluginDocument = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline.sync, 'plugin:test'), {
    ...baseline.settings,
    profiles: [...baseline.settings.profiles, { ...baseline.settings.profiles[0], id: 'office', label: 'Office' }],
  })
  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  await PUT(request('PUT', token, { sync: pluginDocument }), ctx)

  const staleSave = {
    ...baseline.settings,
    profiles: [{ ...baseline.settings.profiles[0], label: 'Renamed Local' }],
  }
  const saved = await PUT(request('PUT', undefined, { settings: staleSave, baseSync: baseline.sync }), ctx)
  expect((await saved.json()).settings.profiles.map((profile: { id: string; label: string }) => [profile.id, profile.label])).toEqual([
    ['ollama-local', 'Renamed Local'],
    ['office', 'Office'],
  ])
})

test('plugin deletion is retained when an older service document reconnects', async () => {
  const initial = await GET(request('GET'), ctx)
  const baseline = await initial.json()
  const office = { ...baseline.settings.profiles[0], id: 'office', label: 'Office' }
  const withOffice = await PUT(request('PUT', undefined, { settings: { ...baseline.settings, profiles: [...baseline.settings.profiles, office] }, baseSync: baseline.sync }), ctx)
  const created = await withOffice.json()
  const pluginDelete = applySettingsToAgentSyncDocument(withAgentSyncActor(created.sync, 'plugin:test'), {
    ...created.settings,
    profiles: [created.settings.profiles[0]],
  })
  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  await PUT(request('PUT', token, { sync: pluginDelete }), ctx)

  const reconnected = await PUT(request('PUT', token, { sync: withAgentSyncActor(created.sync, 'plugin:stale') }), ctx)
  expect((await reconnected.json()).settings.profiles.map((profile: { id: string }) => profile.id)).toEqual(['ollama-local'])
})

test('a service edit made after observing the plugin version wins the same field', async () => {
  const initial = await GET(request('GET'), ctx)
  const baseline = await initial.json()
  const pluginDocument = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline.sync, 'plugin:test'), {
    ...baseline.settings,
    profiles: [{ ...baseline.settings.profiles[0], label: 'Plugin Label' }],
  })
  const token = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo-game' }).token
  const pluginSaved = await PUT(request('PUT', token, { sync: pluginDocument }), ctx)
  const observed = await pluginSaved.json()

  const serviceSaved = await PUT(
    request('PUT', undefined, {
      settings: { ...observed.settings, profiles: [{ ...observed.settings.profiles[0], label: 'Service Label' }] },
      baseSync: observed.sync,
    }),
    ctx
  )
  expect((await serviceSaved.json()).settings.profiles[0].label).toBe('Service Label')

  const stalePlugin = await PUT(request('PUT', token, { sync: pluginDocument }), ctx)
  expect((await stalePlugin.json()).settings.profiles[0].label).toBe('Service Label')
})
