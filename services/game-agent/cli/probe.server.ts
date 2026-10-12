import { type CliAgentProvider, PROVIDER_META } from '@/lib/game-agent/providers'
import { agentProxyEnv } from '@/services/game-agent/proxy/agent-proxy'

import type { OllamaModel } from '../types'
import { type AcpModel, type AcpSession, startAcpSession } from './acp-session.server'
import { ANTIGRAVITY_SETTINGS, ANTIGRAVITY_SETTINGS_PATH, antigravityEnv, antigravityModels, runAntigravityPrompt } from './antigravity.server'
import { CODEX_CONFIG_TOML, readCodexAccount } from './auth/codex-device.server'
import { getCursorAuthStatus } from './auth/cursor-local.server'
import { classifyCliError } from './classify-error'
import { cursorIsolatedHome } from './cli-home.server'
import { type CodexAppServer, startCodexAppServer } from './codex-app-server.server'
import { runCodexTurn } from './codex-turn.server'
import { acquireCredentialLease, createOnceCwd, type CredentialLease } from './credentials/runtime-dir.server'
import { markCredentialsExpired } from './credentials/store.server'
import { AgentCliError } from './errors'
import { cliEnv } from './process.server'
import { requireCli, resolveCli } from './resolve-cli.server'

export type CliProbeProfile = { id: string; provider: CliAgentProvider; defaultModel?: string; proxy?: string }

export type CliProbeResult = {
  models: OllamaModel[]
  /** Empty means `auto`: the CLI's own default (Codex: its catalog default). */
  defaultModel: string
  /** Display name of the model that answered the test prompt. */
  model?: string
  latencyMs?: number
}

const PROMPT_TIMEOUT_MS = 30_000
const TEST_PROMPT = '这是一次连通性测试，不需要使用任何工具。请只回复 OK。'

type Probe = { models: OllamaModel[]; model?: string; latencyMs?: number }

function abortError(label: string) {
  return new AgentCliError('AGENT_CLI_TIMEOUT', `${label} 测试已取消`)
}

/** The CLI's "Auto" entry is represented by an empty `defaultModel`, not listed as a model. */
function acpModels(models: AcpModel[]): OllamaModel[] {
  return models.filter((model) => !/^default\b/i.test(model.id) && model.name.toLowerCase() !== 'auto').map((model) => ({ name: model.id, label: model.name }))
}

function labelFor(models: OllamaModel[], name: string) {
  return models.find((model) => model.name === name)?.label || name
}

async function probeAcp(session: AcpSession, profile: CliProbeProfile, prompt: boolean, signal?: AbortSignal): Promise<Probe> {
  const models = acpModels(session.models)
  if (!prompt) return { models }
  if (session.modeIds.includes('ask')) await session.setMode('ask').catch(() => undefined)
  const wanted = profile.defaultModel?.trim()
  if (wanted) {
    if (models.length && !models.some((model) => model.name === wanted)) throw new AgentCliError('AGENT_MODEL_UNAVAILABLE', `模型「${wanted}」不在当前账号的可用列表中，请更换模型`)
    await session.setModel(wanted)
  }
  const startedAt = Date.now()
  await session.prompt(TEST_PROMPT, { timeoutMs: PROMPT_TIMEOUT_MS, signal })
  const current = session.models.find((model) => model.id === session.currentModelId)
  return { models, model: wanted ? labelFor(models, wanted) : current?.name || 'auto', latencyMs: Date.now() - startedAt }
}

async function probeCursor(profile: CliProbeProfile, prompt: boolean, signal?: AbortSignal): Promise<Probe> {
  const status = await getCursorAuthStatus({ proxy: profile.proxy })
  if (status.state === 'signed_out') throw new AgentCliError('AGENT_AUTH_REQUIRED', 'Cursor 未登录，请在设置中登录')
  const file = await requireCli('cursor')
  const env = cliEnv(file, { ...(await agentProxyEnv(profile.proxy)), ...cursorIsolatedHome(), CURSOR_API_KEY: '' })
  const cwd = createOnceCwd()
  let session: AcpSession | null = null
  const close = () => session?.close()
  signal?.addEventListener('abort', close, { once: true })
  try {
    session = await startAcpSession({ file, args: ['acp'], env, cwd: cwd.dir, label: 'Cursor CLI' })
    if (signal?.aborted) throw abortError('Cursor')
    return await probeAcp(session, profile, prompt, signal)
  } catch (error) {
    throw classifyCliError(signal?.aborted ? abortError('Cursor') : error, { provider: 'cursor', label: 'Cursor', stderr: session?.stderr() })
  } finally {
    signal?.removeEventListener('abort', close)
    close()
    cwd.remove()
  }
}

type CodexModel = { id?: unknown; model?: unknown; displayName?: unknown; hidden?: unknown; isDefault?: unknown }

async function codexModels(server: CodexAppServer): Promise<{ models: OllamaModel[]; fallback?: string }> {
  const listed = await server.request<{ data?: CodexModel[] }>('model/list', { includeHidden: false }).catch(() => null)
  const data = (listed?.data || []).filter((model) => model.hidden !== true && typeof (model.model ?? model.id) === 'string')
  const models = data.map((model) => {
    const name = String(model.model ?? model.id)
    return { name, label: typeof model.displayName === 'string' && model.displayName ? model.displayName : name }
  })
  const fallback = data.find((model) => model.isDefault === true)
  return { models, fallback: fallback ? String(fallback.model ?? fallback.id) : models[0]?.name }
}

async function probeCodex(profile: CliProbeProfile, prompt: boolean, signal?: AbortSignal): Promise<Probe> {
  const file = await requireCli('codex')
  const { version } = await resolveCli('codex')
  const env = await agentProxyEnv(profile.proxy)
  const lease: CredentialLease = await acquireCredentialLease(profile.id, { extraFiles: { 'config.toml': CODEX_CONFIG_TOML } })
  const cwd = createOnceCwd()
  let server: CodexAppServer | null = null
  const close = () => server?.close()
  signal?.addEventListener('abort', close, { once: true })
  try {
    server = await startCodexAppServer({ file, codexHome: lease.dir, version, env })
    await readCodexAccount(server).catch(() => {
      throw new AgentCliError('AGENT_AUTH_EXPIRED', 'Codex 授权已失效，请在设置中重新授权')
    })
    const { models, fallback } = await codexModels(server)
    if (!prompt) return { models }
    const wanted = profile.defaultModel?.trim()
    if (wanted && models.length && !models.some((model) => model.name === wanted))
      throw new AgentCliError('AGENT_MODEL_UNAVAILABLE', `模型「${wanted}」不在当前账号的可用列表中，请更换模型`)
    const model = wanted || fallback
    const startedAt = Date.now()
    await runCodexTurn(server, { cwd: cwd.dir, model, text: TEST_PROMPT, timeoutMs: PROMPT_TIMEOUT_MS, signal, label: 'Codex 测试' })
    return { models, model: model ? labelFor(models, model) : 'auto', latencyMs: Date.now() - startedAt }
  } catch (error) {
    const classified = classifyCliError(signal?.aborted ? abortError('Codex') : error, { provider: 'codex', label: 'Codex', stderr: server?.stderr() })
    if (classified.code === 'AGENT_AUTH_EXPIRED') markCredentialsExpired(profile.id, lease.generation)
    throw classified
  } finally {
    signal?.removeEventListener('abort', close)
    close()
    cwd.remove()
    await lease.release()
  }
}

async function probeGemini(profile: CliProbeProfile, prompt: boolean, signal?: AbortSignal): Promise<Probe> {
  const file = await requireCli('gemini')
  const proxyEnv = await agentProxyEnv(profile.proxy)
  const lease = await acquireCredentialLease(profile.id, { extraFiles: { [ANTIGRAVITY_SETTINGS_PATH]: ANTIGRAVITY_SETTINGS } })
  const env = antigravityEnv(file, lease.dir, proxyEnv)
  const cwd = createOnceCwd()
  try {
    const models = await antigravityModels(file, env, signal)
    if (!prompt) return { models }
    const wanted = profile.defaultModel?.trim()
    if (wanted && !models.some((model) => model.name === wanted)) throw new AgentCliError('AGENT_MODEL_UNAVAILABLE', `模型「${wanted}」不在当前账号的可用列表中，请更换模型`)
    const startedAt = Date.now()
    await runAntigravityPrompt(file, { env, cwd: cwd.dir, prompt: TEST_PROMPT, model: wanted, timeoutMs: PROMPT_TIMEOUT_MS, signal })
    return { models, model: wanted ? labelFor(models, wanted) : 'auto', latencyMs: Date.now() - startedAt }
  } catch (error) {
    const classified = classifyCliError(signal?.aborted ? abortError('Gemini') : error, { provider: 'gemini', label: 'Gemini' })
    if (classified.code === 'AGENT_AUTH_EXPIRED') markCredentialsExpired(profile.id, lease.generation)
    throw classified
  } finally {
    cwd.remove()
    await lease.release()
  }
}

/**
 * Connection test (`prompt: true`) and model list for CLI agent types: a throwaway session without MCP tools,
 * one read-only prompt, everything closed afterwards.
 */
export async function probeCliProfile(profile: CliProbeProfile, options: { prompt: boolean; signal?: AbortSignal }): Promise<CliProbeResult> {
  let probe: Probe
  if (profile.provider === 'cursor') probe = await probeCursor(profile, options.prompt, options.signal)
  else if (profile.provider === 'codex') probe = await probeCodex(profile, options.prompt, options.signal)
  else if (profile.provider === 'gemini') probe = await probeGemini(profile, options.prompt, options.signal)
  else throw new AgentCliError('AGENT_AUTH_UNAVAILABLE', `${PROVIDER_META[profile.provider].label} 的授权与测试将在后续版本开放`)
  const wanted = profile.defaultModel?.trim() || ''
  return { models: probe.models, defaultModel: probe.models.some((model) => model.name === wanted) ? wanted : '', model: probe.model, latencyMs: probe.latencyMs }
}
