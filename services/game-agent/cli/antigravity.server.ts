import path from 'node:path'
import { createInterface } from 'node:readline'

import type { OllamaModel } from '../types'
import { AgentCliError } from './errors'
import { cliEnv, killCliTree, runCliOnce, spawnCli, StderrBuffer } from './process.server'

/** Relative to the CLI home; the only file persisted as ciphertext. */
export const ANTIGRAVITY_TOKEN_PATH = '.gemini/antigravity-cli/antigravity-oauth-token'
export const ANTIGRAVITY_SETTINGS_PATH = '.gemini/antigravity-cli/settings.json'

/** Built-in tools stay off: Chaya only exposes its own MCP tools to the model. */
export const ANTIGRAVITY_SETTINGS = JSON.stringify({
  enableTelemetry: false,
  toolPermission: 'request-review',
  permissions: { allow: [], deny: ['command(*)', 'read_file(*)', 'write_file(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)', 'unsandboxed(*)'] },
})

const MODELS_TIMEOUT_MS = 30_000

export function antigravityEnv(file: string, home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return cliEnv(file, {
    ...extra,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
    NO_BROWSER: 'true',
    // Without a remote-session marker agy keeps the token in the OS keychain instead of a file Chaya can encrypt.
    SSH_CONNECTION: '127.0.0.1 1 127.0.0.1 1',
  })
}

export async function antigravityModels(file: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<OllamaModel[]> {
  const result = await runCliOnce(file, ['models'], { env, timeoutMs: MODELS_TIMEOUT_MS, signal })
  if (result.timedOut) throw new AgentCliError('AGENT_CLI_TIMEOUT', 'Antigravity 获取模型列表超时')
  const models = result.stdout.split(/\r?\n/).flatMap((line) => {
    const [id, ...label] = line.trim().split('\t')
    return id && label.length && /^[a-z0-9][a-z0-9._-]+$/.test(id) ? [{ name: id, label: label.join(' ').trim() || id }] : []
  })
  if (result.code !== 0 || !models.length) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Antigravity 未返回可用模型，请检查 Google 订阅授权')
  return models
}

type AntigravityResult = { status?: unknown; response?: unknown; error?: unknown }

/** One stream-json turn in plan mode; resolves with the final response text. */
export function runAntigravityPrompt(
  file: string,
  input: { env: NodeJS.ProcessEnv; cwd: string; prompt: string; model?: string; timeoutMs: number; signal?: AbortSignal }
): Promise<string> {
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan', '--effort', 'low', '--disable-slash-commands']
  if (input.model) args.push('--model', input.model)
  return new Promise((resolve, reject) => {
    const child = spawnCli(file, args, { env: input.env, cwd: input.cwd })
    const stderr = new StderrBuffer()
    let result: AntigravityResult | null = null
    let text = ''
    let timedOut = false
    let aborted = false
    const stop = () => killCliTree(child)
    const onAbort = () => {
      aborted = true
      stop()
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, input.timeoutMs)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      let event: { event?: unknown; result?: AntigravityResult; step_update?: { step_type?: unknown; text_delta?: unknown } }
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event.event === 'result' && event.result) result = event.result
      const step = event.event === 'step_update' ? event.step_update : null
      if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string') text += step.text_delta
    })
    let settled = false
    const done = (error: Error | null, value = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      lines.close()
      if (error) reject(error)
      else resolve(value)
    }
    child.once('error', (error) => done(error))
    child.once('close', (code) => {
      if (aborted) return done(new AgentCliError('AGENT_CLI_TIMEOUT', 'Antigravity 运行已取消'))
      if (timedOut) return done(new AgentCliError('AGENT_CLI_TIMEOUT', 'Antigravity 运行超时'))
      const final = result as AntigravityResult | null
      if (code !== 0 || final?.status !== 'SUCCESS') {
        const detail =
          typeof final?.error === 'string' && final.error
            ? final.error
            : stderr
                .toString()
                .replace(/https?:\/\/\S+/g, '[URL]')
                .trim()
        return done(new Error(detail.slice(-1000) || `Antigravity 运行失败（退出码 ${code}）`))
      }
      done(null, typeof final.response === 'string' && final.response ? final.response : text)
    })
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') done(error)
    })
    child.stdin?.end(`${JSON.stringify({ event: 'user', message: { content: input.prompt } })}\n`)
  })
}
