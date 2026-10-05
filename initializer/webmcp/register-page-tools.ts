import { type DocumentModelContext, getDocumentModelContext, type WebMcpToolDefinition } from './model-context'
import { webMcpError } from './result'

export interface RegisteredPageTool {
  name: string
  registrarId: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: WebMcpToolDefinition['annotations']
}

/** Each registration is its own entry, so a late rollback from a remounted registrar never drops the new one. */
const toolOwners = new Map<string, RegisteredPageTool>()
const toolDefinitions = new Map<string, WebMcpToolDefinition>()
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

export function listRegisteredPageTools(): RegisteredPageTool[] {
  return [...toolOwners.values()]
}

/** Internal Agent entry point. It executes the same wrapped implementation registered with WebMCP. */
export async function executeRegisteredPageTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = toolDefinitions.get(name)
  if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`)
  return tool.execute(input)
}

/** Called whenever the registered set changes (integration page list). */
export function subscribeRegisteredPageTools(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function withErrorEnvelope(definition: WebMcpToolDefinition): WebMcpToolDefinition {
  return {
    ...definition,
    execute: async (input) => {
      try {
        return await definition.execute(input ?? {})
      } catch (error) {
        return webMcpError('internal_error', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

async function registerOne(modelContext: DocumentModelContext | null, registrarId: string, definition: WebMcpToolDefinition, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const owner = toolOwners.get(definition.name)
  if (owner) {
    if (owner.registrarId === registrarId) {
      if (modelContext) await modelContext.registerTool(toolDefinitions.get(definition.name)!, { signal })
      return
    }
    const message = `[WebMCP] tool "${definition.name}" already registered by "${owner.registrarId}", rejected from "${registrarId}"`
    if (process.env.NODE_ENV === 'development') throw new Error(message)
    // eslint-disable-next-line no-console -- duplicate tool skipped in production; keep a trace
    console.warn(message)
    return
  }
  const wrapped = withErrorEnvelope(definition)
  const entry: RegisteredPageTool = {
    name: definition.name,
    registrarId,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
  }
  toolOwners.set(definition.name, entry)
  toolDefinitions.set(definition.name, wrapped)
  notify()
  const release = () => {
    if (toolOwners.get(definition.name) !== entry) return
    toolOwners.delete(definition.name)
    toolDefinitions.delete(definition.name)
    notify()
  }
  signal.addEventListener('abort', release, { once: true })
  if (!modelContext) return
  try {
    await modelContext.registerTool(wrapped, { signal })
  } catch (error) {
    release()
    if (signal.aborted) return
    throw error
  }
}

/** Register a fixed set; aborting `signal` unregisters them. Returns false when WebMCP is unavailable. */
export async function registerPageTools(registrarId: string, tools: WebMcpToolDefinition[], signal: AbortSignal): Promise<boolean> {
  const modelContext = getDocumentModelContext()
  const results = await Promise.allSettled(tools.map((tool) => registerOne(modelContext, registrarId, tool, signal)))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
  return Boolean(modelContext)
}

function toolFingerprint(tool: WebMcpToolDefinition): string {
  return JSON.stringify([tool.description, tool.inputSchema, tool.annotations ?? null])
}

export interface PageToolSync {
  /** Diff against the current set: add new, abort removed, re-register changed. False when WebMCP is unavailable. */
  sync: (tools: WebMcpToolDefinition[]) => Promise<boolean>
  dispose: () => void
}

/** For registrars whose tool set changes at runtime (MCP mirror, plugin tools). */
export function createPageToolSync(registrarId: string): PageToolSync {
  const live = new Map<string, { controller: AbortController; fingerprint: string }>()
  let disposed = false

  const drop = (name: string) => {
    live.get(name)?.controller.abort()
    live.delete(name)
  }

  return {
    async sync(tools) {
      if (disposed) return false
      const modelContext = getDocumentModelContext()
      const next = new Map(tools.map((tool) => [tool.name, tool]))
      for (const name of [...live.keys()]) {
        const tool = next.get(name)
        if (!tool || toolFingerprint(tool) !== live.get(name)?.fingerprint) drop(name)
      }
      const added: Promise<void>[] = []
      for (const tool of next.values()) {
        if (live.has(tool.name)) continue
        const controller = new AbortController()
        live.set(tool.name, { controller, fingerprint: toolFingerprint(tool) })
        added.push(
          registerOne(modelContext, registrarId, tool, controller.signal).catch((error: unknown) => {
            if (live.get(tool.name)?.controller === controller) live.delete(tool.name)
            throw error
          })
        )
      }
      const results = await Promise.allSettled(added)
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
      return Boolean(modelContext)
    },
    dispose() {
      disposed = true
      for (const name of [...live.keys()]) drop(name)
    },
  }
}
