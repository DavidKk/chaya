/**
 * Agent bridge wire format: MCP server ⇄ in-game ChayaAgent (HTTP long-poll, local only).
 * The game POSTs results + presence and receives queued commands in the same round trip.
 */

export const AGENT_INPUT_KEYS = ['ok', 'cancel', 'shift', 'menu', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'escape'] as const
export type AgentInputKey = (typeof AGENT_INPUT_KEYS)[number]

export type AgentCommand =
  | { id: string; method: 'game.state'; params: Record<string, never> }
  | { id: string; method: 'plugins.list'; params: Record<string, never> }
  | { id: string; method: 'plugin.call'; params: { plugin: string; method: string; args?: unknown[]; chain?: { method: string; args?: unknown[] }[] } }
  | { id: string; method: 'input.press'; params: { key: AgentInputKey; frames?: number } }
  | { id: string; method: 'game.eval'; params: { code: string } }

export type AgentMethod = AgentCommand['method']
export type AgentParams<M extends AgentMethod> = Extract<AgentCommand, { method: M }>['params']

export type AgentResult = { id: string; ok: true; data: unknown } | { id: string; ok: false; error: string }

export type AgentGameInfo = { name?: string; gameRoot?: string; contentRoot?: string; plugins?: string[] }

/** Game → server: deliver results, refresh presence, then wait for the next commands. */
export type AgentPollRequest = { roomId: string; info?: AgentGameInfo; results?: AgentResult[] }
export type AgentPollResponse = { ok: true; commands: AgentCommand[] }

export const AGENT_POLL_WAIT_MS = 25_000
/** A game is "connected" if it polled within this window (poll wait + slack). */
export const AGENT_GAME_TTL_MS = AGENT_POLL_WAIT_MS + 20_000
export const AGENT_CALL_TIMEOUT_MS = 15_000
