import { CLI_PROVIDERS_FEATURE } from '@/lib/game-agent/providers'
import {
  agentSettingsFromSyncDocument,
  agentSyncDocumentForReader,
  agentSyncDocumentFromSettings,
  applySettingsDiffToAgentSyncDocument,
  applySettingsToAgentSyncDocument,
  createEmptyAgentSyncDocument,
  isAgentSyncRecordVisible,
  mergeAgentSyncDocuments,
  parseAgentSyncDocument,
  withAgentSyncActor,
} from '@/lib/game-agent/settings-sync'

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
      modelRequestTimeoutMs: 10_000,
      modelTimeoutMs: 120_000,
      gameCallTimeoutMs: 15_000,
      proxy: '',
    },
  ],
}

test('merges independent fields instead of replacing the whole Agent', () => {
  const baseline = agentSyncDocumentFromSettings(settings, 'service', 10)
  const plugin = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline, 'plugin:a'), {
    ...settings,
    profiles: [{ ...settings.profiles[0], label: 'Game Agent' }],
  })
  const service = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline, 'service'), {
    ...settings,
    profiles: [{ ...settings.profiles[0], defaultModel: 'gemma3' }],
  })

  expect(agentSettingsFromSyncDocument(mergeAgentSyncDocuments(service, plugin)).profiles[0]).toMatchObject({
    label: 'Game Agent',
    defaultModel: 'gemma3',
  })
})

test('an empty initial cache cannot erase the other side', () => {
  const service = agentSyncDocumentFromSettings(settings, 'service')
  const merged = mergeAgentSyncDocuments(createEmptyAgentSyncDocument('plugin:a'), service)
  expect(agentSettingsFromSyncDocument(merged)).toEqual(settings)
})

test('explicit deletion creates a tombstone and stale data cannot resurrect it', () => {
  const baseline = agentSyncDocumentFromSettings({ ...settings, profiles: [...settings.profiles, { ...settings.profiles[0], id: 'office', label: 'Office' }] }, 'service', 5)
  const deleted = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline, 'plugin:a'), settings, 1234)
  const office = deleted.agents.find((record) => record.id === 'office')!
  expect(office.deletedAtMs).toBe(1234)
  expect(isAgentSyncRecordVisible(office)).toBe(false)

  const merged = mergeAgentSyncDocuments(deleted, baseline)
  expect(agentSettingsFromSyncDocument(merged).profiles.map((profile) => profile.id)).toEqual(['local'])
})

test('rejects incomplete cache documents instead of treating them as empty state', () => {
  expect(parseAgentSyncDocument({ version: 1, actorId: 'plugin:a', clock: 1, agents: [], order: null })).toBeNull()
})

test('fills timeout defaults when reading a sync document saved before timeout settings existed', () => {
  const legacy = agentSyncDocumentFromSettings(settings, 'service') as unknown as {
    agents: Array<{ values: Record<string, unknown>; fieldStamps: Record<string, unknown> }>
  }
  for (const record of legacy.agents) {
    delete record.values.modelRequestTimeoutMs
    delete record.values.modelTimeoutMs
    delete record.values.gameCallTimeoutMs
    delete record.fieldStamps.modelRequestTimeoutMs
    delete record.fieldStamps.modelTimeoutMs
    delete record.fieldStamps.gameCallTimeoutMs
  }

  const parsed = parseAgentSyncDocument(legacy)

  expect(parsed && agentSettingsFromSyncDocument(parsed).profiles[0]).toMatchObject({
    modelRequestTimeoutMs: 10_000,
    modelTimeoutMs: 120_000,
    gameCallTimeoutMs: 15_000,
  })
})

test('a reader that predates proxy settings cannot clear a proxy it never saw', () => {
  const service = applySettingsToAgentSyncDocument(agentSyncDocumentFromSettings(settings, 'service', 5), {
    ...settings,
    profiles: [{ ...settings.profiles[0], proxy: 'socks5://127.0.0.1:7890' }],
  })
  const legacy = JSON.parse(JSON.stringify(withAgentSyncActor(agentSyncDocumentFromSettings(settings, 'plugin:old', 9), 'plugin:old'))) as {
    agents: Array<{ values: Record<string, unknown>; fieldStamps: Record<string, unknown> }>
  }
  for (const record of legacy.agents) {
    delete record.values.proxy
    delete record.fieldStamps.proxy
    record.values.label = 'Old Reader'
  }
  const parsed = parseAgentSyncDocument(legacy)!
  expect(agentSettingsFromSyncDocument(parsed).profiles[0].proxy).toBe('')

  expect(agentSettingsFromSyncDocument(mergeAgentSyncDocuments(service, parsed)).profiles[0]).toMatchObject({ label: 'Old Reader', proxy: 'socks5://127.0.0.1:7890' })
})

test('a stale form save keeps Agents added after its read baseline', () => {
  const baseline = agentSyncDocumentFromSettings(settings, 'service', 5)
  const latest = applySettingsToAgentSyncDocument(withAgentSyncActor(baseline, 'plugin:a'), {
    ...settings,
    profiles: [...settings.profiles, { ...settings.profiles[0], id: 'office', label: 'Office' }],
  })
  const desired = { ...settings, profiles: [{ ...settings.profiles[0], label: 'Renamed Local' }] }
  const next = applySettingsDiffToAgentSyncDocument(withAgentSyncActor(latest, 'service'), settings, desired)

  expect(agentSettingsFromSyncDocument(next).profiles.map((profile) => [profile.id, profile.label])).toEqual([
    ['local', 'Renamed Local'],
    ['office', 'Office'],
  ])
})

const cliProfile = (provider: 'cursor' | 'codex' | 'claude' | 'gemini') => ({
  ...settings.profiles[0],
  id: `${provider}-agent`,
  label: provider,
  provider,
  endpoint: '',
  defaultModel: '',
})

test('round-trips every provider type through the sync document', () => {
  const all = { ...settings, profiles: [...settings.profiles, ...(['cursor', 'codex', 'claude', 'gemini'] as const).map(cliProfile)] }
  const parsed = parseAgentSyncDocument(JSON.parse(JSON.stringify(agentSyncDocumentFromSettings(all, 'service'))))
  expect(parsed && agentSettingsFromSyncDocument(parsed).profiles.map((profile) => profile.provider)).toEqual(['ollama', 'cursor', 'codex', 'claude', 'gemini'])
})

test('rejects unknown provider values', () => {
  const document = agentSyncDocumentFromSettings(settings, 'service') as unknown as { agents: Array<{ values: Record<string, unknown> }> }
  document.agents[0].values.provider = 'openai'
  expect(parseAgentSyncDocument(document)).toBeNull()
})

test('readers without the CLI feature see only Ollama agents', () => {
  const document = agentSyncDocumentFromSettings({ ...settings, profiles: [...settings.profiles, cliProfile('codex')] }, 'service')
  const legacy = agentSyncDocumentForReader(document)
  expect(agentSettingsFromSyncDocument(legacy).profiles.map((profile) => profile.id)).toEqual(['local'])
  expect(legacy.order.ids).toEqual(['local'])
  expect(agentSyncDocumentForReader(document, [CLI_PROVIDERS_FEATURE])).toBe(document)
})

test('an older reader reordering or deleting Ollama agents keeps hidden CLI agents', () => {
  const office = { ...settings.profiles[0], id: 'office', label: 'Office' }
  const service = agentSyncDocumentFromSettings({ ...settings, profiles: [...settings.profiles, office, cliProfile('claude')] }, 'service', 5)
  const legacy = withAgentSyncActor(agentSyncDocumentForReader(service), 'plugin:old')
  const edited = applySettingsToAgentSyncDocument(legacy, { ...settings, profiles: [office] })

  expect(agentSettingsFromSyncDocument(mergeAgentSyncDocuments(service, edited)).profiles.map((profile) => profile.id)).toEqual(['office', 'claude-agent'])
})
