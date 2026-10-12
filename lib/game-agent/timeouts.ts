export const DEFAULT_AGENT_MODEL_REQUEST_TIMEOUT_MS = 10_000
export const DEFAULT_AGENT_MODEL_TIMEOUT_MS = 120_000
export const DEFAULT_AGENT_GAME_CALL_TIMEOUT_MS = 15_000

export type AgentTimeoutSettings = {
  modelRequestTimeoutMs: number
  modelTimeoutMs: number
  gameCallTimeoutMs: number
}

function timeout(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 600_000 ? Math.round(parsed) : fallback
}

export function normalizeAgentTimeouts(value: Partial<AgentTimeoutSettings>): AgentTimeoutSettings {
  return {
    modelRequestTimeoutMs: timeout(value.modelRequestTimeoutMs, DEFAULT_AGENT_MODEL_REQUEST_TIMEOUT_MS),
    modelTimeoutMs: timeout(value.modelTimeoutMs, DEFAULT_AGENT_MODEL_TIMEOUT_MS),
    gameCallTimeoutMs: timeout(value.gameCallTimeoutMs, DEFAULT_AGENT_GAME_CALL_TIMEOUT_MS),
  }
}
