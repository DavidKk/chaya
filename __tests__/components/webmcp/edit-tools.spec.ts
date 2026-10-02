import { buildEditTools, type EditLinkDeps } from '@/components/webmcp/edit-tools'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

function link(overrides: Partial<EditLinkDeps> = {}) {
  const listeners = new Set<(msg: GameLinkMessage) => void>()
  const deps: EditLinkDeps = {
    connected: () => true,
    send: jest.fn(),
    subscribeMessages: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    acquireEditSession: () => () => {},
    ...overrides,
  }
  return { deps, listeners }
}

const setTool = (deps: EditLinkDeps) => buildEditTools(deps).find((tool) => tool.name === 'chaya_web_edit_set')!

describe('chaya_web_edit_* tools', () => {
  const g = globalThis as unknown as { window?: unknown }
  beforeEach(() => {
    g.window = globalThis
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    delete g.window
  })

  it('returns game_offline when the link is down', async () => {
    const { deps } = link({ connected: () => false })
    expect(await setTool(deps).execute({ op: 'gold', value: 1 })).toMatchObject({ ok: false, error: 'game_offline' })
  })

  it('fails immediately and cleans up when send throws', async () => {
    const send = jest.fn(() => {
      throw new Error('通道已关闭')
    })
    const { deps, listeners } = link({ send })
    expect(await setTool(deps).execute({ op: 'gold', value: 1 })).toEqual({ ok: false, error: 'tool_error', message: '通道已关闭' })
    expect(listeners.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('resends until the matching ack arrives', async () => {
    const { deps, listeners } = link()
    const result = setTool(deps).execute({ op: 'gold', value: 5 }) as Promise<unknown>
    await Promise.resolve()
    jest.advanceTimersByTime(1_000)
    const sent = (deps.send as jest.Mock).mock.calls.map(([msg]) => msg)
    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect(sent[0]).toMatchObject({ type: 'edit.cmd', op: 'gold', value: 5 })
    for (const fn of listeners) fn({ type: 'edit.ack', cmdId: sent[0].cmdId, ok: true, fields: ['gold'] } as GameLinkMessage)
    expect(await result).toEqual({ ok: true, result: { applied: true, fields: ['gold'] } })
    expect(listeners.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })
})
