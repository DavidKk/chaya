import { type AgentCliStatus, type CliAgentProvider, PROVIDER_META } from '@/lib/game-agent/providers'
import { findCli } from '@/services/integration/mcp-clients'

import { AgentCliError } from './errors'
import { cliEnv, runCliOnce } from './process.server'

export type ResolvedCli = AgentCliStatus & { path?: string }

const CACHE_MS = 60_000
const VERSION_TIMEOUT_MS = 5_000

const cache = new Map<CliAgentProvider, { at: number; value: Promise<ResolvedCli> }>()

function parseVersion(output: string) {
  return output.match(/\d+(?:\.\d+)+(?:[-+][\w.]+)?/)?.[0]
}

async function probe(provider: CliAgentProvider): Promise<ResolvedCli> {
  const meta = PROVIDER_META[provider]
  const file = meta.cli ? findCli(meta.cli) : null
  if (!file) return { found: false, installHint: meta.installHint }
  try {
    const result = await runCliOnce(file, ['--version'], { env: cliEnv(file), timeoutMs: VERSION_TIMEOUT_MS })
    return { found: true, path: file, version: parseVersion(result.stdout) || parseVersion(result.stderr), installHint: meta.installHint }
  } catch {
    return { found: true, path: file, installHint: meta.installHint }
  }
}

export function resolveCli(provider: CliAgentProvider, options: { force?: boolean } = {}): Promise<ResolvedCli> {
  const cached = cache.get(provider)
  if (cached && !options.force && Date.now() - cached.at < CACHE_MS) return cached.value
  const value = probe(provider)
  cache.set(provider, { at: Date.now(), value })
  value.catch(() => cache.delete(provider))
  return value
}

export async function requireCli(provider: CliAgentProvider): Promise<string> {
  let resolved = await resolveCli(provider)
  if (!resolved.path) resolved = await resolveCli(provider, { force: true })
  if (!resolved.path) {
    const meta = PROVIDER_META[provider]
    throw new AgentCliError('AGENT_CLI_NOT_FOUND', `未找到 ${meta.label} CLI（${meta.cli}）${meta.installHint ? `，请先安装：${meta.installHint}` : ''}`)
  }
  return resolved.path
}

export function clearCliCache() {
  cache.clear()
}
