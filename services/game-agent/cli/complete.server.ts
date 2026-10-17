import { parseCliReply, renderCliPrompt } from '@/lib/game-agent/cli-tool-protocol'
import { CLI_AUTO_MODEL, type CliAgentProvider, PROVIDER_META } from '@/lib/game-agent/providers'
import type { RuntimeMessage, RuntimeTool } from '@/lib/game-agent/runtime'
import { agentProxyEnv } from '@/services/game-agent/proxy/agent-proxy'

import { type AcpClient, startAcpClient } from './acp-session.server'
import { ANTIGRAVITY_SETTINGS, ANTIGRAVITY_SETTINGS_PATH, antigravityEnv, runAntigravityPrompt } from './antigravity.server'
import { CODEX_CONFIG_TOML } from './auth/codex-device.server'
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
import { type WarmHandle, withWarmCli } from './warm-pool.server'

export type CliCompleteProfile = {
  id: string
  provider: CliAgentProvider
  proxy?: string
  proxyProtocols?: import('@/lib/game-agent/proxy').AgentProxyProtocols
  proxyHeaders?: Record<string, string>
}

export type CliCompleteInput = { model?: string; messages: RuntimeMessage[]; tools: RuntimeTool[]; timeoutMs: number; signal?: AbortSignal }

type Prompt = { instructions: string; prompt: string; model?: string; timeoutMs: number; signal?: AbortSignal }

function joined(input: Prompt) {
  return `${input.instructions}\n\n${input.prompt}`
}

function warmKey(profile: CliCompleteProfile) {
  return {
    key: `${profile.provider}:${profile.id}:${profile.proxy || ''}:${JSON.stringify(profile.proxyHeaders || {})}`,
    profileId: profile.id,
    provider: profile.provider,
  }
}

async function startCursor(profile: CliCompleteProfile): Promise<WarmHandle<{ client: AcpClient; cwd: string }>> {
  const file = await requireCli('cursor')
  const env = cliEnv(file, { ...(await agentProxyEnv(profile)), ...cursorIsolatedHome(), CURSOR_API_KEY: '' })
  const cwd = createOnceCwd()
  try {
    const client = await startAcpClient({ file, args: ['acp'], env, cwd: cwd.dir, label: 'Cursor CLI' })
    return {
      value: { client, cwd: cwd.dir },
      alive: () => !client.closed,
      dispose: () => {
        client.close()
        cwd.remove()
      },
    }
  } catch (error) {
    cwd.remove()
    throw error
  }
}

async function cursorText(profile: CliCompleteProfile, input: Prompt) {
  const status = await getCursorAuthStatus({ proxy: profile.proxy, proxyHeaders: profile.proxyHeaders })
  if (status.state === 'signed_out') throw new AgentCliError('AGENT_AUTH_REQUIRED', 'Cursor 未登录，请在设置中登录')
  let stderr: (() => string) | undefined
  try {
    return await withWarmCli(
      warmKey(profile),
      () => startCursor(profile),
      async ({ client, cwd }) => {
        stderr = () => client.stderr()
        const session = await client.newSession(cwd)
        if (session.modeIds.includes('ask')) await session.setMode('ask').catch(() => undefined)
        if (input.model) await session.setModel(input.model)
        return (await session.prompt(joined(input), { timeoutMs: input.timeoutMs, signal: input.signal })).text
      }
    )
  } catch (error) {
    throw classifyCliError(error, { provider: 'cursor', label: 'Cursor', stderr: stderr?.() })
  }
}

async function startCodex(profile: CliCompleteProfile): Promise<WarmHandle<{ server: CodexAppServer; lease: CredentialLease; cwd: string }>> {
  const file = await requireCli('codex')
  const { version } = await resolveCli('codex')
  const env = await agentProxyEnv(profile)
  const lease = await acquireCredentialLease(profile.id, { extraFiles: { 'config.toml': CODEX_CONFIG_TOML } })
  const cwd = createOnceCwd()
  const cleanup = async () => {
    cwd.remove()
    await lease.release()
  }
  try {
    const server = await startCodexAppServer({ file, codexHome: lease.dir, version, env })
    let exited = false
    void server.exited.then(() => (exited = true))
    return {
      value: { server, lease, cwd: cwd.dir },
      alive: () => !exited,
      dispose: async () => {
        server.close()
        await cleanup()
      },
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

async function codexText(profile: CliCompleteProfile, input: Prompt) {
  let stderr: (() => string) | undefined
  let generation: number | undefined
  try {
    return await withWarmCli(
      warmKey(profile),
      () => startCodex(profile),
      async ({ server, lease, cwd }) => {
        stderr = () => server.stderr()
        generation = lease.generation
        const text = await runCodexTurn(server, {
          cwd,
          model: input.model,
          text: input.prompt,
          baseInstructions: input.instructions,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })
        await lease.sync()
        return text
      }
    )
  } catch (error) {
    const classified = classifyCliError(error, { provider: 'codex', label: 'Codex', stderr: stderr?.() })
    if (classified.code === 'AGENT_AUTH_EXPIRED' && generation !== undefined) markCredentialsExpired(profile.id, generation)
    throw classified
  }
}

async function geminiText(profile: CliCompleteProfile, input: Prompt) {
  const file = await requireCli('gemini')
  const proxyEnv = await agentProxyEnv(profile)
  const lease = await acquireCredentialLease(profile.id, { extraFiles: { [ANTIGRAVITY_SETTINGS_PATH]: ANTIGRAVITY_SETTINGS } })
  const cwd = createOnceCwd()
  const run = () =>
    runAntigravityPrompt(file, {
      env: antigravityEnv(file, lease.dir, proxyEnv),
      cwd: cwd.dir,
      prompt: joined(input),
      model: input.model,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    })
  try {
    try {
      return await run()
    } catch (error) {
      // A run that ends without SUCCESS for no known reason (e.g. the model emitting a malformed native call) is one-off; each run starts fresh.
      if (input.signal?.aborted || classifyCliError(error, { provider: 'gemini', label: 'Gemini' }).code !== 'AGENT_CLI_CRASHED') throw error
      return await run()
    }
  } catch (error) {
    const classified = classifyCliError(error, { provider: 'gemini', label: 'Gemini' })
    if (classified.code === 'AGENT_AUTH_EXPIRED') markCredentialsExpired(profile.id, lease.generation)
    throw classified
  } finally {
    cwd.remove()
    await lease.release()
  }
}

/**
 * One model round for a CLI agent type, shaped like an Ollama chat reply so `runAgentTurn` keeps owning the tool loop,
 * player cards and confirmations. Each round is a fresh, tool-less conversation in an empty directory; Cursor and Codex
 * reuse a warm process between rounds.
 */
export async function completeWithCli(profile: CliCompleteProfile, input: CliCompleteInput): Promise<RuntimeMessage> {
  const { instructions, prompt } = renderCliPrompt(input.messages, input.tools)
  const model = input.model && input.model !== CLI_AUTO_MODEL ? input.model : undefined
  const request: Prompt = { instructions, prompt, model, timeoutMs: input.timeoutMs, signal: input.signal }
  let text: string
  if (profile.provider === 'cursor') text = await cursorText(profile, request)
  else if (profile.provider === 'codex') text = await codexText(profile, request)
  else if (profile.provider === 'gemini') text = await geminiText(profile, request)
  else throw new AgentCliError('AGENT_AUTH_UNAVAILABLE', `${PROVIDER_META[profile.provider].label} 暂不支持`)
  if (!text.trim()) throw new AgentCliError('AGENT_CLI_CRASHED', `${PROVIDER_META[profile.provider].label} 没有返回内容`)
  return parseCliReply(text)
}
