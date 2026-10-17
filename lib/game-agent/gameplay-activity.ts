export const GAMEPLAY_ACTIVITY_TYPES = [
  'agent.observation',
  'agent.decision',
  'agent.verification',
  'navigation.completed',
  'game.dialogue',
  'game.choices_shown',
  'game.choice_selected',
  'game.gold_changed',
  'game.inventory_changed',
  'game.map_changed',
] as const

export type GameplayActivityType = (typeof GAMEPLAY_ACTIVITY_TYPES)[number]

export function isGameplayActivityType(value: string): value is GameplayActivityType {
  return (GAMEPLAY_ACTIVITY_TYPES as readonly string[]).includes(value)
}

export type GameplayActivityEvent = {
  type: GameplayActivityType
  stepId: string
  actionId: string
  summary: string
  details?: unknown
}

type ToolContext = {
  name: string
  input: Record<string, unknown>
  output: unknown
  ok: boolean
  stepId: string
  actionId: string
  durationMs: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function position(value: unknown): string {
  const point = record(value)
  return point && point.x != null && point.y != null ? `(${String(point.x)}, ${String(point.y)})` : ''
}

function stateObservation(output: unknown) {
  const envelope = record(output)
  const state = record(envelope?.state) || envelope
  if (!state) return null
  const map = record(state.map)
  const player = position(state.player)
  const nearby = Array.isArray(state.nearbyEvents) ? state.nearbyEvents.length : 0
  const message = record(state.message)
  const parts = [map?.name || map?.displayName ? `地图：${String(map.name || map.displayName)}` : map?.id != null ? `地图 #${String(map.id)}` : '', player ? `位置：${player}` : '']
  if (nearby) parts.push(`附近可互动目标 ${nearby} 个`)
  if (message?.text) parts.push(`当前对话：${String(message.text)}`)
  return { summary: parts.filter(Boolean).join('；') || '已读取当前游戏状态。', details: state }
}

export function decisionEventForTool(name: string, input: Record<string, unknown>, stepId: string, actionId: string): GameplayActivityEvent | null {
  if (name === 'chaya_live_interact') {
    return {
      type: 'agent.decision',
      stepId,
      actionId,
      summary: '选择前往并与目标互动。',
      details: { chosen: { id: input.eventId, action: 'interact' }, reason: '模型根据玩家目标与最新游戏状态选择了该互动目标。' },
    }
  }
  if (name === 'chaya_live_move_to') {
    return {
      type: 'agent.decision',
      stepId,
      actionId,
      summary: `选择前往位置 ${position(input) || '未知位置'}。`,
      details: { chosen: { action: 'move', x: input.x, y: input.y }, reason: '模型根据玩家目标与最新游戏状态选择了该位置。' },
    }
  }
  if (name === 'chaya_live_press') {
    return {
      type: 'agent.decision',
      stepId,
      actionId,
      summary: `选择输入 ${String(input.key ?? '按键')}。`,
      details: { chosen: { action: 'press', key: input.key }, reason: '模型根据当前对话、菜单或游戏状态选择了该输入。' },
    }
  }
  return null
}

export function gameplayEventsForTool(context: ToolContext): GameplayActivityEvent[] {
  const { name, input, output, ok, stepId, actionId, durationMs } = context
  const base = { stepId, actionId }
  if (name === 'chaya_live_state' || name === 'chaya_live_ui') {
    const observation = stateObservation(output)
    return observation ? [{ type: 'agent.observation', ...base, ...observation }] : []
  }

  const result = record(output)
  if (!result) return []
  const events: GameplayActivityEvent[] = []
  const navigation = record(result.navigation)
  if (navigation) {
    const start = position(navigation.start)
    const end = position(navigation.finalPosition || result.position)
    const outcome = String(navigation.outcome || result.outcome || (ok ? 'completed' : 'failed'))
    events.push({
      type: 'navigation.completed',
      ...base,
      summary: `寻路${outcome === 'arrived' ? '已到达' : outcome === 'no_path' ? '失败' : '结束'}${start || end ? `：${start || '?'} → ${end || '?'}` : ''}（${durationMs} ms）。`,
      details: navigation,
    })
  } else if (name === 'chaya_live_move_to') {
    const arrived = result.arrived === true
    events.push({
      type: 'navigation.completed',
      ...base,
      summary: `${arrived ? '已到达' : '未到达'}目标位置 ${position(result.target || input)}；当前位置 ${position(result.position) || '未知'}（${durationMs} ms）。`,
      details: result,
    })
  }

  if (Array.isArray(result.messages)) {
    for (const message of result.messages) {
      const line = record(message)
      if (!line?.text) continue
      events.push({
        type: 'game.dialogue',
        ...base,
        summary: `${line.speaker ? `${String(line.speaker)}：` : ''}${String(line.text)}`,
        details: line,
      })
    }
  }
  if (Array.isArray(result.choices) && result.choices.length) {
    events.push({ type: 'game.choices_shown', ...base, summary: `出现选项：${result.choices.map(String).join(' / ')}`, details: { choices: result.choices } })
  }
  const history = record(result.history)
  if (Array.isArray(history?.entries)) {
    for (const entry of history.entries) {
      const item = record(entry)
      if (item?.kind === 'message' && item.text) {
        events.push({ type: 'game.dialogue', ...base, summary: `${item.speaker ? `${String(item.speaker)}：` : ''}${String(item.text)}`, details: item })
      } else if (item?.kind === 'choices' && Array.isArray(item.choices)) {
        events.push({ type: 'game.choices_shown', ...base, summary: `出现选项：${item.choices.map(String).join(' / ')}`, details: item })
      } else if (item?.kind === 'choice') {
        events.push({
          type: 'game.choice_selected',
          ...base,
          summary: `选择${item.text ? `“${String(item.text)}”` : `第 ${Number(item.index) + 1} 项`}。`,
          details: item,
        })
      } else if (item?.kind === 'map') {
        events.push({ type: 'game.map_changed', ...base, summary: `已切换到${item.mapName ? `“${String(item.mapName)}”` : `地图 #${String(item.mapId ?? '?')}`}。`, details: item })
      }
    }
  }
  const goldChange = Number(result.goldChange)
  if (Number.isFinite(goldChange) && goldChange !== 0) {
    events.push({ type: 'game.gold_changed', ...base, summary: `金币${goldChange > 0 ? `增加 ${goldChange}` : `减少 ${Math.abs(goldChange)}`}。`, details: { change: goldChange } })
  }
  if (Array.isArray(result.inventoryChanges)) {
    for (const change of result.inventoryChanges) {
      const item = record(change)
      const amount = Number(item?.change)
      if (!item || !Number.isFinite(amount) || amount === 0) continue
      events.push({
        type: 'game.inventory_changed',
        ...base,
        summary: `${amount > 0 ? '获得' : '失去'}${String(item.name || '物品')} ×${Math.abs(amount)}。`,
        details: item,
      })
    }
  }
  if (result.transferred === true) {
    events.push({ type: 'game.map_changed', ...base, summary: `已切换到地图 #${String(result.mapId ?? '?')}。`, details: { mapId: result.mapId, scene: result.scene } })
  }

  if (name === 'chaya_live_interact' || name === 'chaya_live_move_to' || name === 'chaya_live_press') {
    const outcome = String(result.outcome || (result.arrived === true ? 'arrived' : ok ? 'completed' : 'failed'))
    const pending = ['choice', 'input_required', 'scene_changed', 'transferred', 'timeout'].includes(outcome)
    const passed = ok && !['no_path', 'no_reaction', 'interrupted', 'failed'].includes(outcome)
    const label = pending ? '操作已产生新的游戏状态，需继续处理。' : passed ? '已根据工具结果验证本次操作。' : '本次操作未达到预期，需要重新观察。'
    events.push({ type: 'agent.verification', ...base, summary: `${label}结果：${outcome}。`, details: { passed, pending, outcome, position: result.position } })
  }
  return events
}
