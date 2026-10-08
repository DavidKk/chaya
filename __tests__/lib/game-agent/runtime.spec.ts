import { type AgentHost, capabilityConfig, runAgentTurn, type RuntimeMessage, type RuntimeTool } from '@/lib/game-agent/runtime'

function host(replies: RuntimeMessage[], tools: RuntimeTool[] = []): { host: AgentHost; calls: string[]; events: unknown[] } {
  const calls: string[] = []
  const events: unknown[] = []
  return {
    calls,
    events,
    host: {
      model: { complete: async () => replies.shift() ?? { role: 'assistant', content: 'done' } },
      tools: {
        list: () => tools,
        call: async (name) => {
          calls.push(name)
          return { ok: true }
        },
      },
      store: { append: jest.fn() },
      events: { emit: (event) => events.push(event) },
      clock: { now: () => 1 },
    },
  }
}

describe('shared agent runtime', () => {
  it('runs the same loop with host adapters', async () => {
    const fixture = host(
      [
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_logs_list', arguments: {} } }] },
        { role: 'assistant', content: '完成' },
      ],
      [{ name: 'chaya_logs_list', groups: ['logs'] }]
    )
    await expect(runAgentTurn(fixture.host, capabilityConfig('ask'), { prompt: '检查' }, new AbortController().signal)).resolves.toEqual({
      text: '完成',
      steps: 2,
      toolCalls: 1,
      reason: 'answered',
    })
    expect(fixture.calls).toEqual(['chaya_logs_list'])
    expect(fixture.events).toContainEqual({ type: 'phase', phase: 'verifying', step: 1, maxSteps: 8 })
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'tool.started', name: 'chaya_logs_list', input: {} }))
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'tool.completed', name: 'chaya_logs_list', output: { ok: true } }))
  })

  it('records public activity and accumulates usage without exposing hidden reasoning', async () => {
    const fixture = host([{ role: 'assistant', content: '完成', usage: { input: 8, output: 2, total: 10 } }])
    await expect(runAgentTurn(fixture.host, capabilityConfig('ask'), { prompt: '检查' }, new AbortController().signal)).resolves.toMatchObject({
      usage: { input: 8, output: 2, total: 10 },
    })
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'thought.updated', summary: expect.objectContaining({ plan: expect.any(String) }) }))
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'model.completed', usage: { input: 8, output: 2, total: 10 } }))
  })

  it('keeps input tools out of ask and write tools out of play', () => {
    expect(capabilityConfig('ask').allowTool({ name: 'chaya_live_press' })).toBe(false)
    expect(capabilityConfig('play').allowTool({ name: 'chaya_edit_apply', groups: ['live'] })).toBe(false)
    expect(capabilityConfig('play').allowTool({ name: 'chaya_live_move_to', groups: ['live'] })).toBe(true)
  })

  it('lets companion observe once and still produce its short reply', async () => {
    const fixture = host(
      [
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
        { role: 'assistant', content: '前面好像有东西。' },
      ],
      [{ name: 'chaya_live_state', groups: ['live'] }]
    )
    await expect(runAgentTurn(fixture.host, capabilityConfig('companion'), { prompt: '看看周围' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      steps: 2,
      toolCalls: 1,
    })
  })

  it('honors stop before another tool call', async () => {
    const controller = new AbortController()
    const fixture = host(
      [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'first', arguments: {} } }, { function: { name: 'second', arguments: {} } }] }],
      [{ name: 'first' }, { name: 'second' }]
    )
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      controller.abort(new DOMException('stopped', 'AbortError'))
      return { ok: true }
    }
    await expect(runAgentTurn(fixture.host, capabilityConfig('ask'), { prompt: 'go' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.calls).toEqual(['first'])
  })

  it('caps tool calls even when one model response requests a large batch', async () => {
    const tools = Array.from({ length: 10 }, (_, index) => ({ name: `tool_${index}` }))
    const fixture = host([{ role: 'assistant', content: '', tool_calls: tools.map((tool) => ({ function: { name: tool.name, arguments: {} } })) }], tools)
    const config = { ...capabilityConfig('ask'), maxToolCalls: 3 }
    await expect(runAgentTurn(fixture.host, config, { prompt: 'go' }, new AbortController().signal)).resolves.toMatchObject({ reason: 'limit', toolCalls: 3 })
    expect(fixture.calls).toHaveLength(3)
  })

  it('stops play after three identical actions and results', async () => {
    const action = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const fixture = host([action, action, action], [{ name: 'chaya_live_press', groups: ['live'] }])
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'no_progress',
      toolCalls: 3,
    })
  })

  it('does not report a text-only play response as successful control', async () => {
    const fixture = host([{ role: 'assistant', content: 'I did it.' }], [{ name: 'chaya_live_press', groups: ['live'] }])
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'unsupported',
      toolCalls: 0,
      text: expect.stringContaining('没有发起任何游戏工具调用'),
    })
  })
})
