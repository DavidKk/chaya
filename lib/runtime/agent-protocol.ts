/**
 * Agent bridge wire format: MCP server ⇄ in-game ChayaAgent (HTTP long-poll, local only).
 * The game POSTs results + presence and receives queued commands in the same round trip.
 */

import type { EditAction } from './edit-ops'
import type { GameEditCmdOp } from './game-link-protocol'
import { type PluginToolMeta, sanitizePluginTools } from './plugin-tools'

export const AGENT_INPUT_KEYS = ['ok', 'cancel', 'shift', 'menu', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'escape'] as const
export type AgentInputKey = (typeof AGENT_INPUT_KEYS)[number]
export type AgentInputStep = { key: AgentInputKey; frames?: number; waitFrames?: number }

export const AGENT_HISTORY_KINDS = ['message', 'choices', 'choice', 'map', 'battle', 'load'] as const
export type AgentHistoryKind = (typeof AGENT_HISTORY_KINDS)[number]
export const AGENT_HISTORY_DEFAULT = 50
export const AGENT_HISTORY_MAX = 300

export const AGENT_SNAP_DEFAULT_WIDTH = 512
export const AGENT_SNAP_MAX_WIDTH = 1280
export const AGENT_MOVE_DEFAULT_MS = 8_000
/** Below AGENT_CALL_TIMEOUT_MS so the long-poll call does not time out first */
export const AGENT_MOVE_MAX_MS = 12_000

export type AgentCommand =
  | { id: string; method: 'game.state'; params: Record<string, never> }
  | { id: string; method: 'game.history'; params: { limit?: number; kinds?: AgentHistoryKind[]; afterSeq?: number } }
  | { id: string; method: 'game.snap'; params: { maxWidth?: number } }
  | { id: string; method: 'game.quit'; params: Record<string, never> }
  | { id: string; method: 'plugins.list'; params: Record<string, never> }
  | { id: string; method: 'plugin.tool'; params: { plugin: string; tool: string; input?: Record<string, unknown> } }
  | { id: string; method: 'input.press'; params: { key: AgentInputKey; frames?: number } }
  | { id: string; method: 'input.sequence'; params: { steps: AgentInputStep[] } }
  | { id: string; method: 'input.tap'; params: { x: number; y: number; frames?: number } }
  | { id: string; method: 'player.moveTo'; params: { x: number; y: number; timeoutMs?: number } }
  | { id: string; method: 'edit.catalog'; params: Record<string, never> }
  | { id: string; method: 'edit.state'; params: Record<string, never> }
  | { id: string; method: 'edit.apply'; params: { op: GameEditCmdOp } }
  | { id: string; method: 'edit.action'; params: { action: EditAction } }
  | { id: string; method: 'game.eval'; params: { code: string } }

export type AgentMethod = AgentCommand['method']
export type AgentParams<M extends AgentMethod> = Extract<AgentCommand, { method: M }>['params']

/** Commands accepted over the game DataChannel (Edge signaling is unauthenticated, so no eval). */
export const AGENT_LINK_METHODS = [
  'game.state',
  'game.history',
  'game.snap',
  'game.quit',
  'plugins.list',
  'plugin.tool',
  'input.press',
  'input.sequence',
  'input.tap',
  'player.moveTo',
  'edit.catalog',
  'edit.state',
  'edit.apply',
  'edit.action',
] as const satisfies readonly AgentMethod[]
/** Translation RPC path that routes to ChayaAgent instead of the translator runtime */
export const AGENT_LINK_PATH = '/agent'

export type AgentResult = { id: string; ok: true; data: unknown } | { id: string; ok: false; error: string }

export type AgentGameInfo = { name?: string; gameRoot?: string; contentRoot?: string; plugins?: string[]; tools?: PluginToolMeta[] }

const INFO_TEXT_MAX = 300
const INFO_PLUGINS_MAX = 32
const PLUGIN_NAME = /^Chaya[A-Z]\w{0,31}$/

function infoText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, INFO_TEXT_MAX) : undefined
}

/** Untrusted game report → known fields only (it is shown to agents and must not spoof `gameId`). */
export function sanitizeAgentGameInfo(raw: unknown): AgentGameInfo | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const info = raw as Record<string, unknown>
  const plugins = Array.isArray(info.plugins) ? info.plugins.filter((name): name is string => typeof name === 'string' && PLUGIN_NAME.test(name)).slice(0, INFO_PLUGINS_MAX) : []
  return { name: infoText(info.name), gameRoot: infoText(info.gameRoot), contentRoot: infoText(info.contentRoot), plugins, tools: sanitizePluginTools(info.tools) }
}

/** Game → server: deliver results, refresh presence, then wait for the next commands. */
export type AgentPollRequest = { roomId: string; info?: AgentGameInfo; results?: AgentResult[] }
export type AgentPollResponse = { ok: true; commands: AgentCommand[] }

export const AGENT_POLL_WAIT_MS = 25_000
/** A game is "connected" if it polled within this window (poll wait + slack). */
export const AGENT_GAME_TTL_MS = AGENT_POLL_WAIT_MS + 20_000
export const AGENT_CALL_TIMEOUT_MS = 15_000
