import type { ChildProcess } from 'node:child_process'
import readline from 'node:readline'

import { AgentCliError } from './errors'
import { killCliTree, spawnCli, StderrBuffer } from './process.server'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type Listener = (params: unknown) => void
type Message = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }

/** Server-to-client requests; throwing answers with a JSON-RPC error. */
export type JsonRpcRequestHandler = (method: string, params: unknown) => unknown

export type JsonRpcProcess = {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params?: unknown): void
  onNotification(method: string, listener: Listener): () => void
  readonly exited: Promise<number | null>
  readonly closed: boolean
  stderr(): string
  close(): void
}

export class JsonRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'JsonRpcError'
  }
}

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Line-delimited JSON-RPC over a CLI's stdio. `jsonrpc: false` omits the `"jsonrpc":"2.0"` field (Codex app-server).
 * Unknown server-to-client requests are answered with "method not found" so the CLI never waits on us.
 */
export function startJsonRpcProcess(input: {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd?: string
  label: string
  jsonrpc: boolean
  onRequest?: JsonRpcRequestHandler
}): JsonRpcProcess {
  const child: ChildProcess = spawnCli(input.file, input.args, { env: input.env, cwd: input.cwd })
  const stderr = new StderrBuffer()
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
  const pending = new Map<number, Pending>()
  const listeners = new Map<string, Set<Listener>>()
  let nextId = 0
  let closed = false

  const send = (message: Record<string, unknown>) => {
    if (closed || !child.stdin?.writable) return
    child.stdin.write(`${JSON.stringify(input.jsonrpc ? { jsonrpc: '2.0', ...message } : message)}\n`)
  }

  const failAll = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      closed = true
      failAll(new AgentCliError('AGENT_CLI_CRASHED', `${input.label} 已退出`))
      resolve(code)
    })
    child.once('error', (error) => {
      closed = true
      failAll(new AgentCliError('AGENT_CLI_CRASHED', `无法启动 ${input.label}：${error.message}`))
      resolve(null)
    })
  })

  const answer = async (message: Message) => {
    try {
      if (!input.onRequest) throw new JsonRpcError('Method not found', -32601)
      send({ id: message.id, result: (await input.onRequest(message.method!, message.params)) ?? null })
    } catch (error) {
      const rpc = error instanceof JsonRpcError ? error : new JsonRpcError(error instanceof Error ? error.message : String(error), -32603)
      send({ id: message.id, error: { code: rpc.code ?? -32603, message: rpc.message } })
    }
  }

  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    let message: Message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.method && message.id !== undefined) {
      void answer(message)
      return
    }
    if (message.method) {
      for (const listener of listeners.get(message.method) || []) listener(message.params)
      return
    }
    if (typeof message.id !== 'number') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new JsonRpcError(String(message.error.message || `${input.label} 请求失败`), message.error.code, message.error.data))
    else entry.resolve(message.result)
  })

  return {
    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
      if (closed) return Promise.reject(new AgentCliError('AGENT_CLI_CRASHED', `${input.label} 已退出`))
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new AgentCliError('AGENT_CLI_TIMEOUT', `${input.label} 请求超时：${method}`))
        }, timeoutMs)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        send(params === undefined ? { id, method } : { id, method, params })
      })
    },
    notify(method, params) {
      send(params === undefined ? { method } : { method, params })
    },
    onNotification(method, listener) {
      const set = listeners.get(method) || new Set()
      set.add(listener)
      listeners.set(method, set)
      return () => set.delete(listener)
    },
    exited,
    get closed() {
      return closed
    },
    stderr: () => stderr.toString(),
    close() {
      if (closed) return
      closed = true
      failAll(new AgentCliError('AGENT_CLI_CRASHED', `${input.label} 会话已关闭`))
      child.stdin?.end()
      killCliTree(child)
    },
  }
}
