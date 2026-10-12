export const GAME_AGENT_PROVIDERS = ['ollama', 'cursor', 'codex', 'claude', 'gemini'] as const
export type GameAgentProvider = (typeof GAME_AGENT_PROVIDERS)[number]
export type CliAgentProvider = Exclude<GameAgentProvider, 'ollama'>
export type RemoteAuthProvider = 'codex' | 'claude' | 'gemini'
export type AgentAuthMode = 'none' | 'local_login' | 'remote'

export type ProviderMeta = {
  label: string
  auth: AgentAuthMode
  runtime: 'ollama' | 'acp' | 'codex' | 'antigravity'
  /** Executable looked up via `findCli` */
  cli?: string
  installHint?: string
}

export const PROVIDER_META: Record<GameAgentProvider, ProviderMeta> = {
  ollama: { label: 'Ollama', auth: 'none', runtime: 'ollama' },
  cursor: { label: 'Cursor', auth: 'local_login', runtime: 'acp', cli: 'agent', installHint: 'curl https://cursor.com/install -fsS | bash' },
  codex: { label: 'GPT（Codex）', auth: 'remote', runtime: 'codex', cli: 'codex', installHint: 'npm install -g @openai/codex' },
  claude: { label: 'Claude', auth: 'remote', runtime: 'acp', cli: 'claude-agent-acp', installHint: 'npm install -g @agentclientprotocol/claude-agent-acp' },
  // Google subscription login goes through the Antigravity CLI; the Gemini CLI cannot hand its OAuth callback to a remote browser.
  gemini: { label: 'Gemini', auth: 'remote', runtime: 'antigravity', cli: 'agy', installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
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

export function isGameAgentProvider(value: unknown): value is GameAgentProvider {
  return typeof value === 'string' && (GAME_AGENT_PROVIDERS as readonly string[]).includes(value)
}

export function isCliProvider(value: unknown): value is CliAgentProvider {
  return isGameAgentProvider(value) && value !== 'ollama'
}

export function isRemoteAuthProvider(value: unknown): value is RemoteAuthProvider {
  return isGameAgentProvider(value) && PROVIDER_META[value].auth === 'remote'
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
