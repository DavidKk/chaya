import { GAME_AGENT_PROVIDERS } from './providers'

export type AgentProfileToolSpec = {
  name: 'chaya_agent_profiles' | 'chaya_agent_profile_create' | 'chaya_agent_profile_update' | 'chaya_agent_profile_delete'
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

const stringParam = (description: string) => ({ type: 'string', description })

export function gameAgentProfileToolSpecs(options: { credentials: boolean; cliProviders?: boolean }): AgentProfileToolSpec[] {
  const fields: Record<string, unknown> = {
    label: stringParam('Display name'),
    endpoint: stringParam('Ollama HTTP or HTTPS service URL (Ollama only)'),
    defaultModel: stringParam('Default model name'),
    temperature: { type: 'number', description: 'Sampling temperature from 0 to 2' },
    keepAlive: stringParam('Ollama keep-alive duration, e.g. 10m or 1h'),
    modelRequestTimeoutMs: { type: 'number', description: 'Timeout for one model proxy request in milliseconds' },
    modelTimeoutMs: { type: 'number', description: 'Overall model operation timeout in milliseconds' },
    gameCallTimeoutMs: { type: 'number', description: 'Game bridge and operation timeout in milliseconds' },
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
      description: options.cliProviders
        ? 'Create an Agent configuration in Chaya Settings > Agents. This creates an Agent configuration, not a game entity. Cursor, Codex, Claude and Gemini configurations still need the user to authorize them in Settings; never ask for or accept their credentials.'
        : 'Create an Ollama configuration in Chaya Settings > Agents. This creates an Agent configuration, not a game entity.',
      inputSchema: {
        type: 'object',
        properties: {
          id: stringParam('Optional stable id'),
          ...(options.cliProviders ? { provider: { type: 'string', enum: [...GAME_AGENT_PROVIDERS], description: 'Agent type, defaults to ollama' } } : {}),
          ...fields,
        },
        required: ['label'],
      },
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
