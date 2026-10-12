import type { CliAgentProvider } from '@/lib/game-agent/providers'
import { redactSecretText } from '@/lib/integration/tools/types'

import { AgentCliError, type AgentCliErrorCode } from './errors'

const AUTH =
  /unauthori[sz]ed|\b401\b|not (?:logged|signed) in|(?:log|sign) ?in (?:required|first)|please (?:log|sign) ?in|authenticat(?:ion|e) (?:required|failed|expired)|token (?:expired|revoked|invalid)|refresh token|invalid[_ ]grant/i
const QUOTA = /\b429\b|rate.?limit|quota|usage limit|too many requests|insufficient (?:credits|balance)|limit (?:reached|exceeded)|out of credits/i
const MODEL = /invalid model|unknown model|unsupported model|model[^.\n]{0,60}(?:not found|unavailable|not supported|does not exist|not available)/i

const SECRET_PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [credential omitted]'],
  [/\bsk-[\w-]{8,}/g, '[credential omitted]'],
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '[credential omitted]'],
  [/([?&](?:code|token|access_token|refresh_token|api_key)=)[^&\s"']+/gi, '$1[credential omitted]'],
  [/(\b[a-z][\w+.-]*:\/\/)[^/\s@:"']+:[^/\s@"']+@/gi, '$1***@'],
]

/** Strips token-shaped strings from CLI messages before they reach the browser or a log line. */
export function sanitizeCliText(text: string, secrets: Iterable<string> = []) {
  let safe = redactSecretText(text, secrets)
  for (const [pattern, replacement] of SECRET_PATTERNS) safe = safe.replace(pattern, replacement)
  return safe.length > 600 ? `${safe.slice(0, 600)}…` : safe
}

function messageOf(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const data = (error as { data?: unknown }).data
  const detail = data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : ''
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message
}

/**
 * Maps CLI / protocol failures to the §9 error codes. Known codes pass through unless stderr explains a crash
 * (expired login, quota); unmatched protocol errors keep their own (sanitized) message.
 */
export function classifyCliError(error: unknown, context: { provider: CliAgentProvider; label: string; stderr?: string }): AgentCliError {
  const known = error instanceof AgentCliError ? error : null
  if (known && known.code !== 'AGENT_CLI_CRASHED') return known
  const message = sanitizeCliText(messageOf(error))
  const haystack = `${message}\n${context.stderr || ''}`
  const coded = (code: AgentCliErrorCode, text: string) => new AgentCliError(code, text)
  if (AUTH.test(haystack)) {
    return context.provider === 'cursor'
      ? coded('AGENT_AUTH_REQUIRED', 'Cursor 未登录或登录已失效，请在设置中登录')
      : coded('AGENT_AUTH_EXPIRED', `${context.label} 授权已失效，请在设置中重新授权`)
  }
  if (QUOTA.test(haystack)) return coded('AGENT_QUOTA_EXCEEDED', `${context.label} 额度不足或被限流，请稍后再试：${message}`)
  if (MODEL.test(message)) return coded('AGENT_MODEL_UNAVAILABLE', `模型不可用，请更换模型：${message}`)
  if (known) return known
  return coded('AGENT_CLI_CRASHED', `${context.label}：${message}`)
}
