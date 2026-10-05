import {
  agentSettingsFromSyncDocument,
  type AgentSyncDocument,
  agentSyncDocumentFromSettings,
  applySettingsToAgentSyncDocument,
  mergeAgentSyncDocuments,
  withAgentSyncActor,
} from '@/lib/game-agent/settings-sync'

import { createPluginGameAgentRequest } from '../../plugins/src/agent-ui/request'

const store = new Map<string, string>()
Object.assign(globalThis, {
  location: { origin: 'http://game.local' },
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  },
})

const settings = {
  version: 1 as const,
  defaultProfileId: 'local',
  profiles: [
    {
      id: 'local',
      label: 'Local Ollama',
      provider: 'ollama' as const,
      endpoint: 'http://127.0.0.1:11434',
      defaultModel: 'qwen3',
      temperature: 0.2,
      keepAlive: '10m',
    },
  ],
}

beforeEach(() => store.clear())

function syncServer(initial = agentSyncDocumentFromSettings(settings, 'service', 10)) {
  let server = initial
  let online = true
  const remote = jest.fn(async (_path: string, init?: RequestInit) => {
    if (!online) throw new Error('offline')
    const body = JSON.parse(String(init?.body)) as { sync: AgentSyncDocument }
    server = withAgentSyncActor(mergeAgentSyncDocuments(server, body.sync), 'service')
    return new Response(JSON.stringify({ settings: agentSettingsFromSyncDocument(server), sync: server }), { status: 200 })
  })
  return {
    remote,
    read: () => agentSettingsFromSyncDocument(server),
    edit: (next: typeof settings) => {
      server = applySettingsToAgentSyncDocument(withAgentSyncActor(server, 'service'), next)
    },
    setOnline: (value: boolean) => {
      online = value
    },
  }
}

test('first plugin sync merges an empty cache without clearing service settings', async () => {
  let server = agentSyncDocumentFromSettings(settings, 'service', 10)
  const received: AgentSyncDocument[] = []
  const remote = jest.fn(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { sync: AgentSyncDocument }
    received.push(body.sync)
    server = withAgentSyncActor(mergeAgentSyncDocuments(server, body.sync), 'service')
    return new Response(JSON.stringify({ settings: agentSettingsFromSyncDocument(server), sync: server }), { status: 200 })
  })
  const request = createPluginGameAgentRequest(remote)

  const first = await request('/api/integration/game-agent')
  const firstBody = await first.json()
  expect(received[0].agents).toHaveLength(0)
  expect(firstBody.settings).toEqual(settings)
  expect(store.get('chaya.gameAgent.pluginSync.v1')).toContain('Local Ollama')

  server = applySettingsToAgentSyncDocument(withAgentSyncActor(server, 'service'), {
    ...settings,
    profiles: [{ ...settings.profiles[0], defaultModel: 'gemma3' }],
  })
  const refreshed = await request('/api/integration/game-agent')
  expect((await refreshed.json()).settings.profiles[0].defaultModel).toBe('gemma3')
})

test('plugin create, edit, and delete are persisted to the service', async () => {
  const server = syncServer()
  const request = createPluginGameAgentRequest(server.remote)
  const initial = await (await request('/api/integration/game-agent')).json()
  const office = { ...initial.settings.profiles[0], id: 'office', label: 'Office' }

  await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...initial.settings, profiles: [...initial.settings.profiles, office] }, baseSync: initial.sync }),
  })
  expect(server.read().profiles.map((profile) => profile.label)).toEqual(['Local Ollama', 'Office'])

  const afterCreate = await (await request('/api/integration/game-agent')).json()
  const edited = { ...office, label: 'Plugin Office', defaultModel: 'gemma3' }
  await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...afterCreate.settings, profiles: [afterCreate.settings.profiles[0], edited] }, baseSync: afterCreate.sync }),
  })
  expect(server.read().profiles[1]).toMatchObject({ label: 'Plugin Office', defaultModel: 'gemma3' })

  const afterEdit = await (await request('/api/integration/game-agent')).json()
  await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...afterEdit.settings, profiles: [afterEdit.settings.profiles[0]] }, baseSync: afterEdit.sync }),
  })
  expect(server.read().profiles.map((profile) => profile.id)).toEqual(['local'])
})

test('offline plugin edits survive reconnect and merge with service edits', async () => {
  const server = syncServer()
  const request = createPluginGameAgentRequest(server.remote)
  const baseline = await (await request('/api/integration/game-agent')).json()
  server.setOnline(false)

  const pending = await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({
      settings: { ...baseline.settings, profiles: [{ ...baseline.settings.profiles[0], label: 'Offline Plugin' }] },
      baseSync: baseline.sync,
    }),
  })
  expect(await pending.json()).toMatchObject({ pendingSync: true, settings: { profiles: [{ label: 'Offline Plugin' }] } })

  server.edit({ ...settings, profiles: [{ ...settings.profiles[0], defaultModel: 'service-model' }] })
  server.setOnline(true)
  const merged = await (await request('/api/integration/game-agent')).json()
  expect(merged.settings.profiles[0]).toMatchObject({ label: 'Offline Plugin', defaultModel: 'service-model' })
  expect(server.read().profiles[0]).toMatchObject({ label: 'Offline Plugin', defaultModel: 'service-model' })
})
