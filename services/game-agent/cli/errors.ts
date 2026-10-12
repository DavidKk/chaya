export const AGENT_CLI_ERROR_STATUS = {
  LOCAL_ONLY: 404,
  AGENT_CLI_NOT_FOUND: 424,
  AGENT_CLI_VERSION_UNSUPPORTED: 424,
  AGENT_AUTH_REQUIRED: 401,
  AGENT_AUTH_EXPIRED: 401,
  AGENT_AUTH_IN_PROGRESS: 409,
  AGENT_PROFILE_CHANGED: 409,
  AGENT_QUOTA_EXCEEDED: 429,
  AGENT_MODEL_UNAVAILABLE: 422,
  AGENT_SESSION_BUSY: 409,
  AGENT_CLI_BUSY: 429,
  AGENT_CREDENTIAL_LOCKED: 409,
  AGENT_AUTH_CHANGED: 409,
  AGENT_AUTH_FAILED: 502,
  AGENT_AUTH_UNAVAILABLE: 501,
  AGENT_AUTH_ATTEMPT_NOT_FOUND: 404,
  AGENT_CLI_UNSAFE_TOOL: 502,
  AGENT_CLI_TIMEOUT: 504,
  AGENT_CLI_CRASHED: 502,
  AGENT_SERVICE_DISCONNECTED: 503,
} as const

export type AgentCliErrorCode = keyof typeof AGENT_CLI_ERROR_STATUS

export class AgentCliError extends Error {
  readonly code: AgentCliErrorCode
  readonly status: number

  constructor(code: AgentCliErrorCode, message: string) {
    super(message)
    this.name = 'AgentCliError'
    this.code = code
    this.status = AGENT_CLI_ERROR_STATUS[code]
  }
}

export function isAgentCliError(error: unknown): error is AgentCliError {
  return error instanceof AgentCliError
}

export function toAgentCliError(error: unknown, fallback: AgentCliErrorCode = 'AGENT_AUTH_FAILED'): AgentCliError {
  if (isAgentCliError(error)) return error
  return new AgentCliError(fallback, error instanceof Error ? error.message : String(error))
}
