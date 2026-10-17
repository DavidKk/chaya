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
  it('finishes equipping after the model verifies the new equipment without another model round', async () => {
    const read = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: { sections: ['equipment', 'ui'] } } }] }
    const press = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const fixture = host(
      [read, press, read, { role: 'assistant', content: '已装备。' }],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_press', groups: ['live'] },
      ]
    )
    let equipped = false
    const call = jest.fn(async (name: string) => {
      if (name === 'chaya_live_press') {
        equipped = true
        return { ok: true }
      }
      return {
        scene: 'Scene_Equip',
        party: [{ equipment: [{ slot: 0, name: equipped ? 'Sword' : null }] }],
        inventory: { weapons: equipped ? [] : [{ name: 'Sword' }] },
        windows: [],
      }
    })
    fixture.host.tools.call = call
    const complete = jest.fn(fixture.host.model.complete)
    fixture.host.model.complete = complete
    await expect(runAgentTurn(fixture.host, capabilityConfig('companion'), { prompt: '帮我装备武器' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      text: '已装备。',
      steps: 4,
    })
    expect(complete).toHaveBeenCalledTimes(4)
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('returns a companion greeting without reading or supplying game state', async () => {
    const fixture = host([{ role: 'assistant', content: '在呢！' }], [{ name: 'chaya_live_state', groups: ['live'] }])
    const complete = jest.fn(fixture.host.model.complete)
    fixture.host.model.complete = complete
    const readState = jest.fn(async () => ({ scene: 'Scene_Title' }))
    fixture.host.tools.call = readState
    await expect(runAgentTurn(fixture.host, capabilityConfig('companion'), { prompt: '在吗' }, new AbortController().signal)).resolves.toMatchObject({
      text: '在呢！',
      steps: 1,
      reason: 'answered',
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(readState).not.toHaveBeenCalled()
    expect(complete.mock.calls[0][0]).toEqual([{ role: 'user', content: '在吗' }])
  })

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
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'tool.started', name: 'chaya_logs_list', stepId: 'step-1', actionId: '1-0', input: {} }))
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'tool.completed', name: 'chaya_logs_list', stepId: 'step-1', actionId: '1-0', output: { ok: true } }))
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
    expect(companion).toMatchObject({ maxSteps: 16, maxToolCalls: 16 })
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

  it.each(['play', 'companion'] as const)('rejects finishing after only opening the equip scene (%s)', async (capability) => {
    const open = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_open_scene', arguments: { scene: 'scene:equip' } } }],
    }
    const press = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }],
    }
    const cancel = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'cancel' } } }],
    }
    const pop = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_open_scene', arguments: { scene: 'scene:pop' } } }],
    }
    // Mirrors the failed companion log: open → ok → ok → cancel → pop → false success.
    const replies: RuntimeMessage[] = [open, { role: 'assistant', content: '装备窗口已打开。' }, press, press, cancel, pop, { role: 'assistant', content: '武器已装备。' }]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_open_scene', groups: ['live'] },
        { name: 'chaya_live_press', groups: ['live'] },
      ]
    )
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      if (name === 'chaya_live_state') return { scene: 'Scene_Equip', nearbyEvents: [], party: [{ equipment: [{ slot: 0, name: null }] }] }
      if (name === 'chaya_live_open_scene') return { done: true, id: 'scene:equip' }
      return { ok: true }
    }
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '武器已装备。' })
    fixture.host.model.complete = complete
    await expect(runAgentTurn(fixture.host, capabilityConfig(capability), { prompt: '帮我装备武器' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'no_progress',
      text: expect.stringContaining('装备栏没有变化'),
      toolCalls: expect.any(Number),
    })
    expect(fixture.calls).toContain('chaya_live_press')
    const nudges = complete.mock.calls.flatMap(([messages]) => messages.filter((message) => message.role === 'user').map((message) => message.content))
    expect(nudges.some((prompt) => prompt.includes('菜单或场景已打开') || prompt.includes('menu or equip') || prompt.includes('party.equipment has not changed'))).toBe(true)
  })

  it.each(['play', 'companion'] as const)('allows finishing equip after party.equipment changes (%s)', async (capability) => {
    const open = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_open_scene', arguments: { scene: 'scene:equip' } } }],
    }
    const press = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }],
    }
    const replies: RuntimeMessage[] = [open, press, press, { role: 'assistant', content: '武器已装备。' }]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_open_scene', groups: ['live'] },
        { name: 'chaya_live_press', groups: ['live'] },
      ]
    )
    let presses = 0
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      if (name === 'chaya_live_press') {
        presses += 1
        return { ok: true }
      }
      if (name === 'chaya_live_state') {
        const equipped = presses >= 2
        return {
          scene: equipped ? 'Scene_Map' : 'Scene_Equip',
          nearbyEvents: [],
          party: [{ equipment: [{ slot: 0, name: equipped ? '短剑' : null }] }],
          windows: equipped ? [] : [{ name: 'slotWindow', active: true, index: 0, options: [{ label: '武器: <空>', symbol: 'slot:0', enabled: true, index: 0 }] }],
        }
      }
      if (name === 'chaya_live_open_scene') return { done: true, id: 'scene:equip' }
      return { ok: true }
    }
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '武器已装备。' })
    fixture.host.model.complete = complete
    await expect(runAgentTurn(fixture.host, capabilityConfig(capability), { prompt: '帮我装备武器' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      text: '武器已装备。',
    })
    // open_scene must auto-refresh state so menu options are visible before the next press.
    const openAt = fixture.calls.indexOf('chaya_live_open_scene')
    expect(openAt).toBeGreaterThanOrEqual(0)
    expect(fixture.calls[openAt + 1]).toBe('chaya_live_state')
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

  it('replaces repeated ordinary map snapshots while keeping the latest snapshot complete', async () => {
    const observe = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] }
    const act = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const replies: RuntimeMessage[] = [observe, observe, observe, act, { role: 'assistant', content: '完成。' }]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_press', groups: ['live'] },
      ]
    )
    let snapshot = 0
    fixture.host.tools.call = async (name) => {
      if (name !== 'chaya_live_state') return { ok: true }
      const current = snapshot++
      return {
        scene: 'Scene_Map',
        player: { x: current, y: 2 },
        nearbyEvents: [{ id: current + 1, interactive: true, label: `event-${current}` }],
        screenText: `ordinary-${current}-${'x'.repeat(1_000)}`,
      }
    }
    const complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '完成。' })
    fixture.host.model.complete = complete

    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '处理附近目标' }, new AbortController().signal)

    const firstRequest = complete.mock.calls[0][0]
    const laterRequest = complete.mock.calls.at(-1)![0]
    expect(firstRequest.filter((message) => message.role === 'tool')).toHaveLength(0)
    expect(laterRequest.filter((message) => message.role === 'tool' && message.content === '{"superseded":true}').length).toBeGreaterThan(0)
    const latestState = laterRequest.filter((message) => message.role === 'tool' && message.tool_name === 'chaya_live_state').at(-1)?.content
    expect(latestState).toContain('"x":3')
    expect(latestState).toContain('"id":4')

    const contextSizes = fixture.events
      .filter((event): event is { type: 'model.requested'; contextChars?: number } => (event as { type?: string }).type === 'model.requested')
      .map((event) => event.contextChars ?? 0)
    expect(contextSizes.length).toBeGreaterThan(1)
    expect(Math.max(...contextSizes)).toBeLessThan(2_000)
  })

  it.each([
    ['battle', { scene: 'Scene_Battle', battle: true, screenText: 'battle-state' }],
    ['dialogue', { scene: 'Scene_Map', message: { busy: true, text: 'dialogue-state' }, screenText: 'dialogue-state' }],
    ['choices', { scene: 'Scene_Map', message: { choices: ['A', 'B'] }, screenText: 'choice-state' }],
  ])('keeps %s snapshots available for complex decisions', async (_name, state) => {
    const observe = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] }
    const act = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] }
    const replies: RuntimeMessage[] = [observe, observe, act, { role: 'assistant', content: '完成。' }]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_press', groups: ['live'] },
      ]
    )
    fixture.host.tools.call = async (name) => (name === 'chaya_live_state' ? state : { ok: true })
    fixture.host.model.complete = jest.fn(async (_messages: RuntimeMessage[]): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '完成。' })

    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '继续处理当前场景' }, new AbortController().signal)

    const requests = fixture.host.model.complete as jest.Mock
    const laterRequest = requests.mock.calls.at(-1)![0] as RuntimeMessage[]
    const toolTexts = laterRequest
      .filter((message) => message.role === 'tool')
      .map((message) => message.content)
      .join('\n')
    expect(toolTexts).toContain(JSON.stringify(state))
    expect(toolTexts.split(JSON.stringify(state)).length).toBeGreaterThanOrEqual(3)
    expect(toolTexts).not.toContain('{"superseded":true}')
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
    const replies: RuntimeMessage[] = [interact(1), interact(2), { role: 'assistant', content: '都完成了。' }]
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
    expect(fixture.calls).toEqual(['chaya_live_interact', 'chaya_live_state', 'chaya_live_interact', 'chaya_live_state'])
    const prompts = complete.mock.calls.flatMap(([messages]) => messages.filter((message) => message.role === 'user').map((message) => message.content))
    expect(prompts.some((prompt) => prompt.includes('interacted with in this turn: [1].'))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes('Reply language: zh-CN'))).toBe(true)
    expect(complete.mock.calls.flatMap(([messages]) => messages.filter((message) => message.role === 'tool').map((message) => message.content)).join('')).toContain(
      '"inactiveEvents":1'
    )
    expect(complete.mock.calls.flatMap(([messages]) => messages.filter((message) => message.role === 'tool').map((message) => message.content)).join('')).not.toContain('"id":3')
    expect(prompts.some((prompt) => prompt.includes('in this turn: [1,2].'))).toBe(true)
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
    expect(interacted).toEqual([1])
    const tools = complete.mock.calls.flatMap(([messages]) => messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content)))
    expect(tools).toContainEqual(expect.objectContaining({ skipped: true, reason: expect.stringContaining('fresh game state') }))
  })

  it('refreshes nearby events after an interaction before choosing the next target', async () => {
    const interact = (eventId: number) => ({ role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_interact', arguments: { eventId } } }] })
    const replies: RuntimeMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
      interact(1),
      interact(2),
      { role: 'assistant', content: '已完成。' },
    ]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_interact', groups: ['live'] },
      ]
    )
    const seen: number[][] = []
    fixture.host.tools.call = async (name, input) => {
      fixture.calls.push(name)
      if (name === 'chaya_live_state') {
        const events = seen.length ? [{ id: 2, interactive: true }] : [{ id: 1, interactive: true }]
        seen.push(events.map((event) => event.id))
        return { scene: 'Scene_Map', nearbyEvents: events }
      }
      return { outcome: 'done', eventId: input.eventId }
    }
    fixture.host.model.complete = jest.fn(async (): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '已完成。' })
    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '打开开关后再打开新出现的宝箱' }, new AbortController().signal)
    expect(fixture.calls).toEqual(['chaya_live_state', 'chaya_live_interact', 'chaya_live_state', 'chaya_live_interact', 'chaya_live_state'])
    expect(seen).toEqual([[1], [2], [2]])
  })

  it('rejects text completion while a structured multi-target task still has work', async () => {
    const interact = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_interact', arguments: { eventId: 2 } } }] }
    const replies: RuntimeMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
      { role: 'assistant', content: '完成了。' },
      interact,
      { role: 'assistant', content: '现在完成了。' },
    ]
    const fixture = host(
      [],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_interact', groups: ['live'] },
      ]
    )
    let completed = false
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      if (name === 'chaya_live_interact') {
        completed = true
        return { outcome: 'done', eventId: 2 }
      }
      return {
        scene: 'Scene_Map',
        nearbyEvents: completed ? [] : [{ id: 2, kind: 'pickup', interactive: true, routeStatus: 'reachable', routeDistance: 2, pageIndex: 0 }],
      }
    }
    fixture.host.model.complete = jest.fn(async (): Promise<RuntimeMessage> => replies.shift() ?? { role: 'assistant', content: '现在完成了。' })

    await expect(runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '交互所有物品' }, new AbortController().signal)).resolves.toMatchObject({
      reason: 'answered',
      text: '现在完成了。',
    })
    expect(fixture.calls).toEqual(['chaya_live_state', 'chaya_live_interact', 'chaya_live_state'])
    const requests = fixture.host.model.complete as jest.Mock
    expect(requests.mock.calls[2][0]).toContainEqual(expect.objectContaining({ role: 'user', content: expect.stringContaining('canFinish=false') }))
  })

  it('blocks an excluded model proposal before it reaches the game', async () => {
    const proposeNpc = { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'chaya_live_interact', arguments: { eventId: 5 } } }] }
    const fixture = host(
      [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] }, proposeNpc, { role: 'assistant', content: '没有其他目标。' }],
      [
        { name: 'chaya_live_state', groups: ['live'] },
        { name: 'chaya_live_interact', groups: ['live'] },
      ]
    )
    fixture.host.tools.call = async (name) => {
      fixture.calls.push(name)
      return { scene: 'Scene_Map', nearbyEvents: [{ id: 5, kind: 'npc', interactive: true, routeStatus: 'reachable', routeDistance: 1 }] }
    }

    await runAgentTurn(fixture.host, capabilityConfig('play'), { prompt: '除人物外全部交互' }, new AbortController().signal)

    expect(fixture.calls).toEqual(['chaya_live_state'])
    expect(fixture.events).toContainEqual(
      expect.objectContaining({ type: 'tool.completed', name: 'chaya_live_interact', ok: false, output: expect.objectContaining({ policyRejected: true }) })
    )
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
