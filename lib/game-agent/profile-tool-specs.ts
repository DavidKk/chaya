export type AgentProfileToolSpec = {
  name: 'chaya_agent_profiles' | 'chaya_agent_profile_create' | 'chaya_agent_profile_update' | 'chaya_agent_profile_delete'
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

const stringParam = (description: string) => ({ type: 'string', description })

export function gameAgentProfileToolSpecs(options: { credentials: boolean }): AgentProfileToolSpec[] {
  const fields: Record<string, unknown> = {
    label: stringParam('Display name'),
    endpoint: stringParam('Ollama HTTP or HTTPS service URL'),
    defaultModel: stringParam('Default Ollama model name'),
    temperature: { type: 'number', description: 'Sampling temperature from 0 to 2' },
    keepAlive: stringParam('Ollama keep-alive duration, e.g. 10m or 1h'),
  }
  if (options.credentials) {
    fields.token = stringParam('Write-only bearer token. It is encrypted locally and never returned by tools.')
    fields.clearToken = { type: 'boolean', description: 'Remove the stored bearer token' }
  }
  return [
    {
      name: 'chaya_agent_profiles',
      description: 'List Chaya Settings > Agents configurations. Use this to resolve an Agent name or id. Credentials are never returned.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
    },
    {
      name: 'chaya_agent_profile_create',
      description: 'Create an Ollama configuration in Chaya Settings > Agents. This creates an Agent configuration, not a game entity.',
      inputSchema: { type: 'object', properties: { id: stringParam('Optional stable id'), ...fields }, required: ['label'] },
      readOnly: false,
    },
    {
      name: 'chaya_agent_profile_update',
      description: 'Update a Chaya Settings > Agents configuration by exact id or display name. Omitted fields stay unchanged.',
      inputSchema: {
        type: 'object',
        properties: { target: stringParam('Exact Agent configuration id or display name'), ...fields },
        required: ['target'],
      },
      readOnly: false,
    },
    {
      name: 'chaya_agent_profile_delete',
      description:
        'Delete a Chaya Settings > Agents configuration by exact id or display name. Use this immediately for requests such as "delete the Agent named Flow Local"; it is not a game NPC or entity. At least one Agent must remain.',
      inputSchema: {
        type: 'object',
        properties: { target: stringParam('Exact Agent configuration id or display name, for example Flow Local') },
        required: ['target'],
      },
      readOnly: false,
    },
  ]
}
