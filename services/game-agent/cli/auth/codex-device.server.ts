import fs from 'node:fs'
import path from 'node:path'

import { accountSummary } from '../account'
import { type CodexAppServer, CodexRpcError, startCodexAppServer } from '../codex-app-server.server'
import { AgentCliError } from '../errors'
import { requireCli, resolveCli } from '../resolve-cli.server'
import type { AuthAttemptHandle, RemoteAuthAdapter } from './remote-adapter'

/** File storage keeps tokens inside the Chaya-owned CODEX_HOME instead of the OS keyring; ChatGPT login only. */
/** Bundled skills stay off: the game agent only follows Chaya's prompt. */
export const CODEX_CONFIG_TOML = 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n\n[skills.bundled]\nenabled = false\n'

const DEVICE_CODE_TTL_MS = 10 * 60_000

type DeviceCodeResponse = { type?: unknown; loginId?: unknown; verificationUrl?: unknown; userCode?: unknown }
type LoginCompleted = { loginId?: unknown; success?: unknown; error?: unknown }
type AccountRead = { account?: { type?: unknown; email?: unknown; planType?: unknown } | null }

async function openServer(codexHome: string, env: Record<string, string>): Promise<CodexAppServer> {
  const file = await requireCli('codex')
  const { version } = await resolveCli('codex')
  return startCodexAppServer({ file, codexHome, version, env })
}

function deviceCodeError(error: unknown) {
  if (error instanceof AgentCliError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/\b403\b/.test(message))
    return new AgentCliError('AGENT_AUTH_FAILED', 'OpenAI 拒绝了设备码请求（403）：当前网络所在地区可能不受支持。可在该 Agent 的「代理」中填写代理并保存后重试')
  return new AgentCliError('AGENT_AUTH_FAILED', `Codex 设备码请求失败：${message}`)
}

export async function readCodexAccount(server: CodexAppServer) {
  const read = await server.request<AccountRead>('account/read', { refreshToken: false })
  if (read?.account?.type !== 'chatgpt') throw new AgentCliError('AGENT_AUTH_FAILED', 'Codex 未登录 ChatGPT 账号')
  return accountSummary(read.account.email, read.account.planType)
}

export const codexAuthAdapter: RemoteAuthAdapter = {
  provider: 'codex',
  credentialFiles: ['auth.json'],
  extraFiles: () => ({ 'config.toml': CODEX_CONFIG_TOML }),

  async start({ stagingDir, signal, env }): Promise<AuthAttemptHandle> {
    fs.writeFileSync(path.join(stagingDir, 'config.toml'), CODEX_CONFIG_TOML, { mode: 0o600 })
    const server = await openServer(stagingDir, env)
    let loginId = ''
    let settle: { resolve: (value: LoginCompleted) => void; reject: (error: Error) => void } | null = null
    const finished = new Promise<LoginCompleted>((resolve, reject) => {
      settle = { resolve, reject }
    })
    server.onNotification('account/login/completed', (params) => {
      const value = params as LoginCompleted
      if (!loginId || value.loginId === loginId || value.loginId == null) settle?.resolve(value)
    })
    void server.exited.then(() => settle?.reject(new AgentCliError('AGENT_CLI_CRASHED', 'Codex CLI 在授权完成前退出')))
    const abort = () => server.close()
    signal.addEventListener('abort', abort, { once: true })

    let response: DeviceCodeResponse
    try {
      response = await server.request<DeviceCodeResponse>('account/login/start', { type: 'chatgptDeviceCode' })
    } catch (error) {
      server.close()
      throw error instanceof CodexRpcError && /unknown variant|invalid/i.test(error.message)
        ? new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', '当前 Codex CLI 不支持设备码授权，请升级 Codex CLI')
        : deviceCodeError(error)
    }
    if (response?.type !== 'chatgptDeviceCode' || typeof response.loginId !== 'string' || typeof response.verificationUrl !== 'string' || typeof response.userCode !== 'string') {
      server.close()
      throw new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', 'Codex CLI 返回的设备码格式无法识别，请升级 Codex CLI')
    }
    loginId = response.loginId

    const completed = finished
      .then(async (result) => {
        if (result.success !== true)
          throw new AgentCliError('AGENT_AUTH_FAILED', typeof result.error === 'string' && result.error ? `Codex 授权失败：${result.error}` : 'Codex 授权失败')
        const account = await readCodexAccount(server)
        if (!fs.existsSync(path.join(stagingDir, 'auth.json'))) throw new AgentCliError('AGENT_AUTH_FAILED', 'Codex 未写出授权文件')
        return { account }
      })
      .finally(() => {
        signal.removeEventListener('abort', abort)
        server.close()
      })

    return {
      challenge: { kind: 'device_code', url: response.verificationUrl, userCode: response.userCode, expiresAt: Date.now() + DEVICE_CODE_TTL_MS },
      completed,
      async cancel() {
        try {
          await server.request('account/login/cancel', { loginId }, 3_000)
        } catch {
          /* The process is closed next either way. */
        }
        server.close()
      },
    }
  },

  async logout({ runtimeDir, signal, env }) {
    const server = await openServer(runtimeDir, env)
    const abort = () => server.close()
    signal.addEventListener('abort', abort, { once: true })
    try {
      await server.request('account/logout', undefined, 10_000)
    } finally {
      signal.removeEventListener('abort', abort)
      server.close()
    }
  },
}
