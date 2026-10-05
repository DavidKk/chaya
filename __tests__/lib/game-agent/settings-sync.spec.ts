import {
  agentSettingsFromSyncDocument,
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
