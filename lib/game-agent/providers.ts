export const GAME_AGENT_PROVIDERS = ['ollama', 'cursor', 'codex', 'claude', 'gemini', 'cc', 'codex-api', 'gemini-api'] as const
export type GameAgentProvider = (typeof GAME_AGENT_PROVIDERS)[number]
export type CliAgentProvider = 'cursor' | 'codex' | 'claude' | 'gemini'
export type OpenApiAgentProvider = 'cc' | 'codex-api' | 'gemini-api'
export type RemoteAuthProvider = 'codex' | 'claude' | 'gemini'
export type AgentAuthMode = 'none' | 'local_login' | 'remote' | 'api_key'
/** How the player-facing label distinguishes subscription CLIs from OpenAPI key profiles. */
export type AgentProviderChannel = 'local' | 'cli' | 'sdk' | 'api'

export type ProviderMeta = {
  label: string
  auth: AgentAuthMode
  runtime: 'ollama' | 'acp' | 'codex' | 'antigravity' | 'openai' | 'gemini'
  channel: AgentProviderChannel
  /** Executable looked up via `findCli` */
  cli?: string
  installHint?: string
  /** Suggested OpenAI-compatible base URL (no trailing slash). */
  defaultEndpoint?: string
}

export const PROVIDER_META: Record<GameAgentProvider, ProviderMeta> = {
  ollama: { label: 'Ollama', auth: 'none', runtime: 'ollama', channel: 'local' },
  cursor: { label: 'Cursor（CLI）', auth: 'local_login', runtime: 'acp', channel: 'cli', cli: 'agent', installHint: 'curl https://cursor.com/install -fsS | bash' },
  codex: { label: 'GPT（Codex · SDK）', auth: 'remote', runtime: 'codex', channel: 'sdk', cli: 'codex', installHint: 'npm install -g @openai/codex' },
  claude: { label: 'Claude（CLI）', auth: 'remote', runtime: 'acp', channel: 'cli', cli: 'claude-agent-acp', installHint: 'npm install -g @agentclientprotocol/claude-agent-acp' },
  // Google subscription login goes through the Antigravity CLI; the Gemini CLI cannot hand its OAuth callback to a remote browser.
  gemini: {
    label: 'Gemini（CLI）',
    auth: 'remote',
    runtime: 'antigravity',
    channel: 'cli',
    cli: 'agy',
    installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  },
  cc: { label: 'Claude Code（API）', auth: 'api_key', runtime: 'openai', channel: 'api', defaultEndpoint: 'https://api.anthropic.com/v1' },
  'codex-api': { label: 'GPT（Codex · API）', auth: 'api_key', runtime: 'openai', channel: 'api', defaultEndpoint: 'https://api.openai.com/v1' },
  // Google Generative Language host (native REST). vercel-gemini-proxy: `https://your-host/api` → …/api/v1beta/…
  // Ending with `/v1beta/openai` still uses the OpenAI-compatible Gemini surface.
  'gemini-api': { label: 'Gemini（API）', auth: 'api_key', runtime: 'gemini', channel: 'api', defaultEndpoint: 'https://generativelanguage.googleapis.com' },
}

/** Model value meaning "let the CLI pick" (an empty `defaultModel`); panels need a non-empty name to send. */
export const CLI_AUTO_MODEL = 'auto'

/** Model choices a status endpoint reports for a CLI instance: always "auto", then the cached account list. */
export function cliModelChoices(defaultModel: string | undefined, cached: readonly { name: string; label?: string }[] = []) {
  const current = defaultModel?.trim() || CLI_AUTO_MODEL
  const models = [{ name: CLI_AUTO_MODEL, label: 'Auto' }, ...cached.filter((model) => model.name !== CLI_AUTO_MODEL)]
  if (!models.some((model) => model.name === current)) models.push({ name: current, label: current })
  return { models, defaultModel: current }
}

/** CLI runs need a sync reader that understands these providers; older plugins only see Ollama. */
export const CLI_PROVIDERS_FEATURE = 'cli-providers'
/** OpenAPI key profiles need the same sync hide/keep treatment as CLI types. */
export const OPENAPI_PROVIDERS_FEATURE = 'openapi-providers'

export function isGameAgentProvider(value: unknown): value is GameAgentProvider {
  return typeof value === 'string' && (GAME_AGENT_PROVIDERS as readonly string[]).includes(value)
}

export function isCliProvider(value: unknown): value is CliAgentProvider {
  return value === 'cursor' || value === 'codex' || value === 'claude' || value === 'gemini'
}

export function isOpenApiProvider(value: unknown): value is OpenApiAgentProvider {
  return value === 'cc' || value === 'codex-api' || value === 'gemini-api'
}

/** Custom OpenAPI base (≠ official) — like web-scripts `proxyEnabled`: gateway auth via request headers, API key optional. */
export function isOpenApiGatewayEndpoint(provider: OpenApiAgentProvider, endpoint: string): boolean {
  const official = (PROVIDER_META[provider].defaultEndpoint || '').replace(/\/+$/, '').toLowerCase()
  const current = endpoint.trim().replace(/\/+$/, '').toLowerCase()
  return !!current && current !== official
}

/** Providers that older sync readers must not see or delete by omission. */
export function isExtendedAgentProvider(value: unknown): value is CliAgentProvider | OpenApiAgentProvider {
  return isCliProvider(value) || isOpenApiProvider(value)
}

export function isRemoteAuthProvider(value: unknown): value is RemoteAuthProvider {
  return isGameAgentProvider(value) && PROVIDER_META[value].auth === 'remote'
}

export function isApiKeyProvider(value: unknown): boolean {
  return isGameAgentProvider(value) && (PROVIDER_META[value].auth === 'api_key' || value === 'ollama')
}

export type AgentAccountSummary = { emailHint?: string; plan?: string }

export type AgentAuthStatus =
  | { mode: 'local_login'; state: 'signed_in' | 'signed_out' | 'unknown'; account?: AgentAccountSummary; reason?: string }
  | { mode: 'remote'; state: 'authorized' | 'unauthorized' | 'expired'; account?: AgentAccountSummary; updatedAt?: number }

export type AgentCliStatus = { found: boolean; version?: string; installHint?: string }

export type AgentProviderAvailability = { available: boolean; reason?: 'cli_missing' | 'unsupported' }

export type AgentAuthChallenge =
  | { kind: 'browser_link'; url: string; expiresAt: number }
  | { kind: 'device_code'; url: string; userCode: string; expiresAt: number }
  | { kind: 'callback_code'; url: string; expiresAt: number }

export type AgentAuthAttemptState = 'pending' | 'completed' | 'failed' | 'cancelled'

export type AgentAuthAttemptView = {
  attemptId: string
  profileId: string
  state: AgentAuthAttemptState
  challenge: AgentAuthChallenge | null
  account?: AgentAccountSummary
  error?: { code: string; message: string }
}
