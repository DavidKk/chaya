import fs from 'node:fs'
import path from 'node:path'

import { accountSummary } from '../account'
import { ANTIGRAVITY_SETTINGS, ANTIGRAVITY_SETTINGS_PATH, ANTIGRAVITY_TOKEN_PATH, antigravityEnv, antigravityModels } from '../antigravity.server'
import { AgentCliError } from '../errors'
import { type PtySpawn, spawnPty } from '../pty.server'
import { requireCli } from '../resolve-cli.server'
import type { AuthAttemptHandle, RemoteAuthAdapter } from './remote-adapter'

const GOOGLE_AUTH_URL = /https:\/\/accounts\.google\.com\/o\/oauth2\/(?:v2\/)?auth\?[^\s\u0007\u001b]+/gu
const ANTIGRAVITY_CALLBACK = 'https://antigravity.google/oauth-callback'
const MAX_OUTPUT_CHARS = 64 * 1024
const CODE_TTL_MS = 10 * 60_000
const CREDENTIAL_POLL_MS = 250

export type GeminiAuthDeps = {
  resolveFile: () => Promise<string>
  spawn: PtySpawn
  verify: (file: string, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<unknown>
  pollMs: number
}

function stripTerminalControl(value: string) {
  return value.replace(/\u001b\][^\u0007]*(?:\u0007|$)/gu, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

/** The Google consent link agy prints, once it is complete (something follows it) and points back to Antigravity. */
export function extractAntigravityLoginUrl(output: string): string | null {
  const plain = stripTerminalControl(output)
  const url = [...plain.matchAll(GOOGLE_AUTH_URL)].at(-1)?.[0]
  if (!url || plain.endsWith(url)) return null
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.get('redirect_uri') !== ANTIGRAVITY_CALLBACK || !parsed.searchParams.get('state') || parsed.searchParams.get('response_type') !== 'code') return null
  } catch {
    return null
  }
  return url
}

function waitForFile(file: string, signal: AbortSignal, pollMs: number) {
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (signal.aborted) return reject(new AgentCliError('AGENT_AUTH_FAILED', '授权已被取消'))
      if (fs.existsSync(file)) return resolve()
      setTimeout(check, pollMs).unref?.()
    }
    check()
  })
}

export function createGeminiAuthAdapter(overrides: Partial<GeminiAuthDeps> = {}): RemoteAuthAdapter {
  const deps: GeminiAuthDeps = {
    resolveFile: () => requireCli('gemini'),
    spawn: spawnPty,
    verify: antigravityModels,
    pollMs: CREDENTIAL_POLL_MS,
    ...overrides,
  }
  return {
    provider: 'gemini',
    credentialFiles: [ANTIGRAVITY_TOKEN_PATH],
    extraFiles: () => ({ [ANTIGRAVITY_SETTINGS_PATH]: ANTIGRAVITY_SETTINGS }),

    async start({ stagingDir, signal, env }): Promise<AuthAttemptHandle> {
      const file = await deps.resolveFile()
      const settingsFile = path.join(stagingDir, ANTIGRAVITY_SETTINGS_PATH)
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true, mode: 0o700 })
      fs.writeFileSync(settingsFile, ANTIGRAVITY_SETTINGS, { mode: 0o600 })
      const processEnv = antigravityEnv(file, stagingDir, env)
      const term = await deps.spawn(file, [], { cwd: stagingDir, env: processEnv, cols: 2048, rows: 20 })
      const stop = new AbortController()
      const kill = () => {
        stop.abort()
        term.kill()
      }
      signal.addEventListener('abort', kill, { once: true })

      let output = ''
      let selectedGoogle = false
      let loginUrl: string | null = null
      let settleUrl: { resolve: (url: string) => void; reject: (error: Error) => void } | null = null
      const urlReady = new Promise<string>((resolve, reject) => (settleUrl = { resolve, reject }))
      term.onData((chunk) => {
        // No terminal emulator sits behind this PTY to answer agy's device queries.
        if (chunk.includes('\u001b[>c')) term.write('\u001b[>0;1;0c')
        if (chunk.includes('\u001b[c')) term.write('\u001b[?1;2c')
        if (chunk.includes('\u001b[6n')) term.write('\u001b[1;1R')
        output = `${output}${chunk}`.slice(-MAX_OUTPUT_CHARS)
        if (loginUrl) return
        if (!selectedGoogle && stripTerminalControl(output).includes('Select login method:')) {
          selectedGoogle = true
          term.write('\r')
        }
        const url = extractAntigravityLoginUrl(output)
        if (!url) return
        loginUrl = url
        settleUrl?.resolve(url)
      })
      void term.exited.then((code) => settleUrl?.reject(new AgentCliError('AGENT_CLI_CRASHED', `Antigravity CLI 在给出授权链接前退出（退出码 ${code}）`)))

      let url: string
      try {
        url = await urlReady
      } catch (error) {
        signal.removeEventListener('abort', kill)
        kill()
        throw error
      }

      const tokenFile = path.join(stagingDir, ANTIGRAVITY_TOKEN_PATH)
      const exitedWithoutToken = term.exited.then((code) => {
        if (fs.existsSync(tokenFile)) return
        throw new AgentCliError('AGENT_AUTH_FAILED', `Gemini 授权失败：授权码无效或已过期，请重新发起（退出码 ${code}）`)
      })
      const completed = Promise.race([waitForFile(tokenFile, stop.signal, deps.pollMs), exitedWithoutToken])
        .then(async () => {
          await deps.verify(file, processEnv, signal).catch((error) => {
            throw new AgentCliError('AGENT_AUTH_FAILED', `Gemini 授权已写入，但读取模型列表失败：${error instanceof Error ? error.message : String(error)}`)
          })
          return { account: accountSummary(undefined, 'Google') }
        })
        .finally(() => {
          signal.removeEventListener('abort', kill)
          kill()
        })

      return {
        challenge: { kind: 'callback_code', url, expiresAt: Date.now() + CODE_TTL_MS },
        completed,
        async submitCode(code) {
          // Anything outside printable ASCII could steer the TUI (newlines submit, escapes move the cursor).
          if (!/^[\x21-\x7e]+$/.test(code)) throw new AgentCliError('AGENT_AUTH_FAILED', '授权码格式不正确，请复制页面上完整的授权码')
          term.write(`${code}\r`)
        },
        async cancel() {
          kill()
        },
      }
    },
  }
}

export const geminiAuthAdapter = createGeminiAuthAdapter()
