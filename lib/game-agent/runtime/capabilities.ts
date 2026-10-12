import type { AgentCapability, RuntimeCapabilityConfig, RuntimeTool } from './types'

const INPUT_TOOL = /(?:^|_)(?:press|play|tap|move_to|moveTo|interact|input)(?:_|$)/i
const WRITE_TOOL = /(?:^|_)(?:edit|delete|clear|write|install|uninstall|eval)(?:_|$)/i

function group(tool: RuntimeTool, value: string): boolean {
  return tool.groups?.includes(value) ?? false
}

export function capabilityConfig(capability: AgentCapability): RuntimeCapabilityConfig {
  if (capability === 'play') {
    return {
      capability,
      maxSteps: 80,
      maxToolCalls: 60,
      allowTool: (tool) =>
        group(tool, 'player') || group(tool, 'agent') || ((group(tool, 'live') || group(tool, 'observe') || INPUT_TOOL.test(tool.name)) && !WRITE_TOOL.test(tool.name)),
    }
  }
  if (capability === 'companion') {
    return {
      capability,
      // A companion request may need observe -> open a scene / press a key -> verify -> reply.
      // Keep destructive edit tools out, but allow the normal live game bridge, including
      // save/load tools, so short in-game requests do not get stranded after observation.
      maxSteps: 8,
      maxToolCalls: 8,
      allowTool: (tool) =>
        group(tool, 'player') || group(tool, 'agent') || ((group(tool, 'live') || group(tool, 'observe')) && !WRITE_TOOL.test(tool.name) && !/(?:^|_)quit(?:_|$)/i.test(tool.name)),
    }
  }
  return { capability, maxSteps: 8, maxToolCalls: 8, allowTool: (tool) => !INPUT_TOOL.test(tool.name) }
}
