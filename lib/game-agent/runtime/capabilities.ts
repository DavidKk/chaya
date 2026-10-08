import type { AgentCapability, RuntimeCapabilityConfig, RuntimeTool } from './types'

const INPUT_TOOL = /(?:^|_)(?:press|play|tap|move_to|moveTo|input)(?:_|$)/i
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
      allowTool: (tool) => (group(tool, 'live') || group(tool, 'observe') || INPUT_TOOL.test(tool.name)) && !WRITE_TOOL.test(tool.name),
    }
  }
  if (capability === 'companion') {
    return {
      capability,
      // One observation tool call still needs a following model step to produce the short reply.
      maxSteps: 2,
      maxToolCalls: 1,
      allowTool: (tool) => (group(tool, 'live') || group(tool, 'observe')) && !INPUT_TOOL.test(tool.name) && !WRITE_TOOL.test(tool.name),
    }
  }
  return { capability, maxSteps: 8, maxToolCalls: 8, allowTool: (tool) => !INPUT_TOOL.test(tool.name) }
}
