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
    await expect(runAgentTurn(fixture.host, capabilityConfig('ask'), { prompt: '检查', model: 'gemini/gemini-2.5-flash' }, new AbortController().signal)).resolves.toMatchObject({
      usage: { input: 8, output: 2, total: 10 },
    })
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'thought.updated', summary: expect.objectContaining({ plan: expect.any(String) }) }))
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'model.requested', model: 'gemini/gemini-2.5-flash' }))
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'model.completed', model: 'gemini/gemini-2.5-flash', usage: { input: 8, output: 2, total: 10 } }))
  })

  it('sends enriched context to the model while storing the original user prompt', async () => {
    const fixture = host([{ role: 'assistant', content: '看到了。' }])
    const complete = jest.fn(async (messages: RuntimeMessage[]) => ({ role: 'assistant' as const, content: messages.at(-1)?.content || '' }))
    fixture.host.model.complete = complete
    await runAgentTurn(
      fixture.host,
      capabilityConfig('ask'),
      { prompt: '帮我开宝箱', modelPrompt: 'Connected game id: game-a\nUser request:\n帮我开宝箱', storePrompt: '帮我开宝箱' },
      new AbortController().signal
    )
    expect(complete.mock.calls[0][0].at(-1)?.content).toContain('Connected game id: game-a')
    expect(fixture.host.store.append).toHaveBeenCalledWith([
      { role: 'user', content: '帮我开宝箱' },
      { role: 'assistant', content: expect.stringContaining('Connected game id: game-a') },
    ])
  })

  it('keeps input tools out of ask and write tools out of play', () => {
    expect(capabilityConfig('ask').allowTool({ name: 'chaya_live_press' })).toBe(false)
    expect(capabilityConfig('ask').allowTool({ name: 'chaya_live_interact' })).toBe(false)
    expect(capabilityConfig('play').allowTool({ name: 'chaya_edit_apply', groups: ['live'] })).toBe(false)
    expect(capabilityConfig('play').allowTool({ name: 'chaya_live_move_to', groups: ['live'] })).toBe(true)
  })

  it('lets companion requests complete basic play and save flows without exposing edits or quit', () => {
    const companion = capabilityConfig('companion')
    expect(companion).toMatchObject({ maxSteps: 8, maxToolCalls: 8 })
    expect(companion.allowTool({ name: 'chaya_live_ui', groups: ['live'] })).toBe(true)
    expect(companion.allowTool({ name: 'chaya_live_open_scene', groups: ['live'] })).toBe(true)
    expect(companion.allowTool({ name: 'chaya_live_press', groups: ['live'] })).toBe(true)
    expect(companion.allowTool({ name: 'chaya_live_save', groups: ['live'] })).toBe(true)
    expect(companion.allowTool({ name: 'chaya_live_load_save', groups: ['live'] })).toBe(true)
    expect(companion.allowTool({ name: 'chaya_live_quit', groups: ['live'] })).toBe(false)
    expect(companion.allowTool({ name: 'chaya_edit_apply', groups: ['live'] })).toBe(false)
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

  it('leaves the decision to the model instead of matching request words', async () => {
    const complete = jest.fn(async () => ({ role: 'assistant' as const, content: '要先装备哪一件？' }))
    const fixture = host([], [{ name: 'chaya_live_open_scene', groups: ['live'] }])
    fixture.host.model.complete = complete
    await expect(
      runAgentTurn(fixture.host, capabilityConfig('companion'), { prompt: '帮我把页面中所有物品都交互一下，然后装备武器' }, new AbortController().signal)
    ).resolves.toMatchObject({ reason: 'answered', text: '要先装备哪一件？', toolCalls: 0 })
    expect(complete).toHaveBeenCalledTimes(1)
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

  it('never clips the system prompt or the current request for companion turns', async () => {
    const fixture = host([{ role: 'assistant', content: '好的。' }])
    const complete = jest.fn(async (_messages: RuntimeMessage[]) => ({ role: 'assistant' as const, content: '好的。' }))
    fixture.host.model.complete = complete
    const system = `rules ${'s'.repeat(4_500)} SYSTEM_TAIL`
    const request = `User request:\n帮我交互 ${'state'.repeat(1_000)} REQUEST_TAIL`
    await runAgentTurn(
      fixture.host,
      capabilityConfig('companion'),
      { prompt: '帮我交互', modelPrompt: request, history: [{ role: 'system', content: system }] },
      new AbortController().signal
    )
    const sent = complete.mock.calls[0][0]
    expect(sent[0].content).toContain('SYSTEM_TAIL')
    expect(sent.at(-1)?.content).toContain('REQUEST_TAIL')
  })

  it('keeps the current request after many tool rounds and compacts game state results', async () => {
    const observe = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] }
    const replies: RuntimeMessage[] = [observe, observe, observe, observe, observe, { role: 'assistant', content: '完成。' }]
    const fixture = host([], [{ name: 'chaya_live_state', groups: ['live'] }])
    fixture.host.tools.call = async () => ({ scene: 'Scene_Map', screenText: 'x'.repeat(4_000), nearbyEvents: [{ id: 1, effects: ['text'], interactive: true }] })
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '完成。' })
    fixture.host.model.complete = complete
    await runAgentTurn(fixture.host, capabilityConfig('companion'), { prompt: 'GOAL_TEXT' }, new AbortController().signal)
    const last = complete.mock.calls.at(-1)![0]
    expect(last.some((message) => message.content === 'GOAL_TEXT')).toBe(true)
    const toolText = last.filter((message) => message.role === 'tool').map((message) => message.content)
    expect(toolText.at(-1)).toContain('"effects":["text"]')
    expect(toolText.join('')).not.toContain('xxxx')
  })

  it('re-prompts play models that answer with text before any tool call', async () => {
    const action = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const fixture = host([{ role: 'assistant', content: '我来看看。' }, action], [{ name: 'chaya_live_press', groups: ['live'] }])
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '帮我开宝箱' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      toolCalls: 1,
    })
    expect(fixture.calls).toEqual(['chaya_live_press'])
  })

  it('nudges after an empty reply instead of resending the same messages', async () => {
    const action = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const replies: RuntimeMessage[] = [{ role: 'assistant', content: '' }, action, { role: 'assistant', content: '完成。' }]
    const fixture = host([], [{ name: 'chaya_live_press', groups: ['live'] }])
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '完成。' })
    fixture.host.model.complete = complete
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      toolCalls: 1,
    })
    const second = complete.mock.calls[1][0]
    expect(second.some((message) => message.role === 'assistant' && !message.content && !message.tool_calls)).toBe(false)
    expect(second.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('empty') })
  })

  it('checks a play reply against fresh state and lists events already interacted with', async () => {
    const interact = (eventId: number) => ({ role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_interact', arguments: { eventId } } }] })
    const replies: RuntimeMessage[] = [interact(1), { role: 'assistant', content: '好了。' }, interact(2), { role: 'assistant', content: '都完成了。' }]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_interact', groups: ['live'] },
      ]
    )
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      return name === 'chaya_live_state'
        ? {
            scene: 'Scene_Map',
            nearbyEvents: [
              { id: 1, interactive: true },
              { id: 2, interactive: true },
              { id: 3, interactive: false },
            ],
          }
        : { outcome: 'done' }
    }
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '都完成了。' })
    fixture.host.model.complete = complete
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go', replyLanguage: 'zh-CN' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      text: '都完成了。',
    })
    expect(fixture.calls).toEqual(['chaya_live_state', 'chaya_live_interact', 'chaya_live_state', 'chaya_live_interact', 'chaya_live_state'])
    const first = complete.mock.calls[2][0]
    expect(first.at(-1)?.content).toContain('already interacted with in this turn: [1].')
    expect(first.at(-1)?.content).toContain('Reply language: zh-CN')
    expect(first.at(-2)).toMatchObject({ role: 'tool', content: expect.stringContaining('"inactiveEvents":1') })
    expect(first.at(-2)?.content).not.toContain('"id":3')
    expect(complete.mock.calls[4][0].at(-1)?.content).toContain('in this turn: [1,2].')
  })

  it('skips the rest of a batch once an interaction leaves a choice on screen', async () => {
    const batch = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [1, 2, 3].map((eventId) => ({ function: { name: 'chaya_live_interact', arguments: { eventId } } })),
    }
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_interact', groups: ['live'] },
      ]
    )
    const interacted: unknown[] = []
    fixture.host.tools.call = async (name, input) => {
      if (name === 'chaya_live_interact') interacted.push(input.eventId)
      return name === 'chaya_live_state' ? { scene: 'Scene_Map', nearbyEvents: [] } : { outcome: input.eventId === 2 ? 'choice' : 'done' }
    }
    const replies: RuntimeMessage[] = [batch, { role: 'assistant', content: '选了。' }]
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '选了。' })
    fixture.host.model.complete = complete
    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)
    expect(interacted).toEqual([1, 2])
    const tools = complete.mock.calls[1][0].filter((message) => message.role === 'tool').slice(-3)
    expect(tools.map((message) => JSON.parse(message.content))).toEqual([{ outcome: 'done' }, { outcome: 'choice' }, expect.objectContaining({ skipped: true })])
  })

  it('stops after repeated empty replies', async () => {
    const empty = { role: 'assistant' as const, content: '' }
    const fixture = host([empty, empty, empty, { role: 'assistant', content: 'late' }], [{ name: 'chaya_live_press', groups: ['live'] }])
    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'no_progress',
      steps: 3,
    })
  })

  it('runs a tool call printed as `name: {args}` and records it as a tool call', async () => {
    const replies: RuntimeMessage[] = [
      { role: 'assistant', content: 'chaya_live_move_to: {"x":3, "y":2}' },
      { role: 'assistant', content: '完成。' },
    ]
    const fixture = host([], [{ name: 'chaya_live_move_to', groups: ['live'] }])
    const inputs: unknown[] = []
    fixture.host.tools.call = async (_name, args) => {
      inputs.push(args)
      return { arrived: true }
    }
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '完成。' })
    fixture.host.model.complete = complete
    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: 'go' }, new AbortController().signal)
    expect(inputs).toEqual([{ x: 3, y: 2 }])
    expect(complete.mock.calls[1][0]).toContainEqual(
      expect.objectContaining({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_move_to', arguments: { x: 3, y: 2 } } }] })
    )
  })
})
