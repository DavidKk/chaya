import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { createPageToolSync, listRegisteredPageTools, registerPageTools, subscribeRegisteredPageTools } from '@/initializer/webmcp/register-page-tools'

type Registered = { definition: WebMcpToolDefinition; signal?: AbortSignal }

function installModelContext() {
  const registered: Registered[] = []
  const modelContext = {
    registerTool: jest.fn((definition: WebMcpToolDefinition, options?: { signal?: AbortSignal }) => {
      registered.push({ definition, signal: options?.signal })
    }),
  }
  ;(globalThis as { document?: unknown }).document = { modelContext }
  const active = () => registered.filter((entry) => !entry.signal?.aborted).map((entry) => entry.definition.name)
  return { modelContext, registered, active }
}

function tool(name: string, description = name, execute: WebMcpToolDefinition['execute'] = () => ({ ok: true })): WebMcpToolDefinition {
  return { name, description, inputSchema: { type: 'object', properties: {} }, execute }
}

describe('register-page-tools', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document
  })

  it('returns false without document.modelContext', async () => {
    expect(await registerPageTools('x', [tool('a')], new AbortController().signal)).toBe(false)
    expect(await createPageToolSync('x').sync([tool('a')])).toBe(false)
  })

  it('tracks registered tools and releases them on abort', async () => {
    const { active } = installModelContext()
    const controller = new AbortController()
    const changes = jest.fn()
    const unsubscribe = subscribeRegisteredPageTools(changes)
    await registerPageTools('page', [tool('t_a', 'A', () => ({ ok: true })), tool('t_b')], controller.signal)
    expect(active()).toEqual(['t_a', 't_b'])
    expect(listRegisteredPageTools().filter((entry) => entry.registrarId === 'page')).toHaveLength(2)
    expect(listRegisteredPageTools().find((entry) => entry.name === 't_a')?.description).toBe('A')
    controller.abort()
    expect(listRegisteredPageTools().some((entry) => entry.registrarId === 'page')).toBe(false)
    expect(changes).toHaveBeenCalled()
    unsubscribe()
  })

  it('wraps thrown execute errors into internal_error envelopes', async () => {
    const { registered } = installModelContext()
    const controller = new AbortController()
    await registerPageTools(
      'boom',
      [
        tool('t_boom', 'boom', () => {
          throw new Error('坏了')
        }),
      ],
      controller.signal
    )
    expect(await registered[0].definition.execute({})).toEqual({ ok: false, error: 'internal_error', message: '坏了' })
    controller.abort()
  })

  it('sync adds, removes and re-registers changed tools only', async () => {
    const { modelContext, active } = installModelContext()
    const sync = createPageToolSync('mirror')
    await sync.sync([tool('m_a'), tool('m_b')])
    expect(active()).toEqual(['m_a', 'm_b'])
    expect(modelContext.registerTool).toHaveBeenCalledTimes(2)

    await sync.sync([tool('m_a'), tool('m_b')])
    expect(modelContext.registerTool).toHaveBeenCalledTimes(2)

    await sync.sync([tool('m_a', 'changed'), tool('m_c')])
    expect(active().sort()).toEqual(['m_a', 'm_c'])
    expect(modelContext.registerTool).toHaveBeenCalledTimes(4)
    expect(listRegisteredPageTools().find((entry) => entry.name === 'm_a')?.description).toBe('changed')

    sync.dispose()
    expect(active()).toEqual([])
    expect(await sync.sync([tool('m_a')])).toBe(false)
  })

  it('rejects duplicate names from another registrar in production', async () => {
    installModelContext()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const first = new AbortController()
    const second = new AbortController()
    await registerPageTools('one', [tool('dup')], first.signal)
    await registerPageTools('two', [tool('dup')], second.signal)
    expect(listRegisteredPageTools().find((entry) => entry.name === 'dup')?.registrarId).toBe('one')
    expect(warn).toHaveBeenCalled()
    first.abort()
    second.abort()
  })
})
