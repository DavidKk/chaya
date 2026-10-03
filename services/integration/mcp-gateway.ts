/**
 * Local server side of the unified MCP gateway: binds the shared port and forwards to this server's `/api/mcp`.
 * Started from `instrumentation.ts`; module state lives on globalThis so dev reloads reuse one listener.
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'

import { MCP_ENDPOINT_PATH } from '@/lib/integration/mcp-endpoint'
import { createMcpGateway, type McpGateway } from '@/lib/integration/mcp-gateway'
import { type McpPortEnv, processMcpPortEnv } from '@/lib/integration/mcp-port'
import { canUseDisk } from '@/lib/service-mode/mode'
import { toolkitListenPort } from '@/services/runtime/presence'

const STORE_KEY = '__chayaLocalMcpGateway'

export function localMcpPortEnv(): McpPortEnv {
  return processMcpPortEnv(os.homedir())
}

/** Next binds `HOSTNAME`; wildcard / unset hosts are reachable on loopback. */
function upstreamHost(): string {
  const host = String(process.env.HOSTNAME || '').trim()
  return !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

async function forwardToApi(body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://${upstreamHost()}:${toolkitListenPort()}${MCP_ENDPOINT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CHAYA_AUTH_TOKEN || ''}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!text) return { status: res.status, body: null }
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: 502, body: { error: `上游返回非 JSON（HTTP ${res.status}）` } }
  }
}

export function localMcpGateway(): McpGateway {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: McpGateway }
  g[STORE_KEY] ??= createMcpGateway({
    http,
    fs,
    env: localMcpPortEnv(),
    identity: { chaya: true, role: 'server' },
    handle: forwardToApi,
    // dev can switch to the edge target at runtime: release the port so a game can take it
    listen: () => canUseDisk(),
    // eslint-disable-next-line no-console -- gateway state belongs in the server terminal
    log: { info: (msg) => console.log(`[Chaya] ${msg}`), warn: (msg) => console.warn(`[Chaya] ${msg}`) },
  })
  return g[STORE_KEY]
}
