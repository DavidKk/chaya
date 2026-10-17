import type { AgentCapability, RuntimeCapabilityConfig, RuntimeTool } from './types'

const INPUT_TOOL = /(?:^|_)(?:press|play|tap|move_to|moveTo|interact|input)(?:_|$)/i
const WRITE_TOOL = /(?:^|_)(?:edit|delete|clear|write|install|uninstall|eval)(?:_|$)/i
const PLAY_TOOLS = new Set([
  'chaya_agent_recall',
  'chaya_live_state',
  'chaya_live_ui',
  'chaya_live_open_scene',
  'chaya_live_history',
  'chaya_live_screenshot',
  'chaya_live_press',
  'chaya_live_play',
  'chaya_live_tap',
  'chaya_live_move_to',
  'chaya_live_interact',
  'chaya_live_save',
  'chaya_live_load_save',
  'chaya_live_saves',
  'chaya_live_saves_load',
])

function group(tool: RuntimeTool, value: string): boolean {
  return tool.groups?.includes(value) ?? false
}

export function capabilityConfig(capability: AgentCapability): RuntimeCapabilityConfig {
  if (capability === 'play') {
    return {
      capability,
      maxSteps: 80,
      maxToolCalls: 60,
      allowTool: (tool) => group(tool, 'player') || PLAY_TOOLS.has(tool.name),
    }
  }
  if (capability === 'companion') {
    return {
      capability,
      // Companion shares play finish gates (observe → act → verify). Equip/menu flows need
      // headroom beyond a single open/press/pop cycle.
      maxSteps: 16,
      maxToolCalls: 16,
      allowTool: (tool) =>
        group(tool, 'player') || group(tool, 'agent') || ((group(tool, 'live') || group(tool, 'observe')) && !WRITE_TOOL.test(tool.name) && !/(?:^|_)quit(?:_|$)/i.test(tool.name)),
    }
  }
  return { capability, maxSteps: 8, maxToolCalls: 8, allowTool: (tool) => !INPUT_TOOL.test(tool.name) }
}
