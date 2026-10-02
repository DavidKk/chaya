import { sanitizeAgentGameInfo } from '@/lib/runtime/agent-protocol'
import { callAgentGame, listAgentGames, pollAgentCommands, resetAgentBridge, resolveAgentGame } from '@/services/runtime/agent-bridge'

describe('agent bridge', () => {
  afterEach(() => resetAgentBridge())

  it('lists polling games and auto-resolves the only one', async () => {
    expect(() => resolveAgentGame()).toThrow('没有已连接的游戏')
    await pollAgentCommands('room-A', { info: { name: 'A' }, waitMs: 0 })
    expect(listAgentGames()).toEqual([expect.objectContaining({ gameId: 'room-A', name: 'A' })])
    expect(resolveAgentGame()).toBe('room-A')
    await pollAgentCommands('room-B', { waitMs: 0 })
    expect(() => resolveAgentGame()).toThrow('请传 gameId')
    expect(resolveAgentGame('room-B')).toBe('room-B')
    expect(() => resolveAgentGame('room-C')).toThrow('未连接')
  })

  it('never lets game info spoof gameId and drops unknown fields', async () => {
    const info = sanitizeAgentGameInfo({ name: ' A ', gameId: 'fake', extra: 'x'.repeat(5000), plugins: ['ChayaEdit', 'evil', 3], tools: [{ plugin: 'ChayaEdit', tool: 'gold' }] })
    expect(info).toEqual({ name: 'A', gameRoot: undefined, contentRoot: undefined, plugins: ['ChayaEdit'], tools: [expect.objectContaining({ tool: 'gold' })] })
    expect(sanitizeAgentGameInfo('nope')).toBeUndefined()
    await pollAgentCommands('room-A', { info: { ...info, gameId: 'fake' } as never, waitMs: 0 })
    expect(listAgentGames()[0]).toMatchObject({ gameId: 'room-A', toolCount: 1 })
  })

  it('keeps commands queued when the long-poll is aborted', async () => {
    const controller = new AbortController()
    const poll = pollAgentCommands('room-A', { waitMs: 5_000, signal: controller.signal })
    controller.abort()
    expect(await poll).toEqual([])
    const call = callAgentGame('room-A', 'game.state', {})
    const [cmd] = await pollAgentCommands('room-A', { waitMs: 0 })
    expect(cmd.method).toBe('game.state')
    await pollAgentCommands('room-A', { results: [{ id: cmd.id, ok: true, data: 1 }], waitMs: 0 })
    await expect(call).resolves.toBe(1)
  })

  it('wakes the long-poll with queued commands and resolves with the result', async () => {
    const poll = pollAgentCommands('room-A', { waitMs: 5_000 })
    const call = callAgentGame('room-A', 'plugin.call', { plugin: 'ChayaEdit', method: 'gold', args: [100] })
    const [cmd] = await poll
    expect(cmd).toMatchObject({ method: 'plugin.call', params: { plugin: 'ChayaEdit', method: 'gold', args: [100] } })
    await pollAgentCommands('room-A', { results: [{ id: cmd.id, ok: true, data: 100 }], waitMs: 0 })
    await expect(call).resolves.toBe(100)
  })

  it('rejects with the game-side error', async () => {
    const call = callAgentGame('room-A', 'game.state', {})
    const [cmd] = await pollAgentCommands('room-A', { waitMs: 0 })
    await pollAgentCommands('room-A', { results: [{ id: cmd.id, ok: false, error: '插件未加载' }], waitMs: 0 })
    await expect(call).rejects.toThrow('插件未加载')
  })

  it('times out and drops the unclaimed command', async () => {
    jest.useFakeTimers()
    try {
      const call = callAgentGame('room-A', 'game.state', {}, 1_000)
      jest.advanceTimersByTime(1_001)
      await expect(call).rejects.toThrow('未响应')
      expect(await pollAgentCommands('room-A', { waitMs: 0 })).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })
})
