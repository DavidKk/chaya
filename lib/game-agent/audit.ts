export const AGENT_AUDIT_SCHEMA_VERSION = 2 as const

export type AgentDomain =
  | 'game_runtime'
  | 'game_launch_configuration'
  | 'game_content'
  | 'game_save'
  | 'game_library'
  | 'plugin_management'
  | 'translation'
  | 'agent_configuration'
  | 'service_configuration'
  | 'global_configuration'
  | 'system'

export type AgentAuditProducerKind = 'agent_coordinator' | 'domain_service' | 'game_plugin' | 'cloud_browser'
export type AgentAuditHost = 'local_service' | 'cloud_browser' | 'game_plugin'
export type AgentAuditEffect = 'read' | 'runtime_change' | 'configuration_change' | 'file_change' | 'external_side_effect'

export type AgentRuntimeIdentity = {
  libraryGameId: string
  runtimeInstanceId: string
  pluginInstanceId: string
  connectionId: string
}

export type AgentAuditProducer = {
  id: string
  kind: AgentAuditProducerKind
  domain?: AgentDomain
  epoch: number
  sourceSeq: number
}

export type AgentAuditTarget = Partial<AgentRuntimeIdentity> & {
  kind: 'game' | 'runtime' | 'plugin' | 'service' | 'resource'
  id: string
  label?: string
}

export type AgentAuditMetadata = {
  schemaVersion: typeof AGENT_AUDIT_SCHEMA_VERSION
  eventId: string
  taskSeq?: number
  producer: AgentAuditProducer
  execution: { host: AgentAuditHost; component: string }
  classification: { domain: AgentDomain; type: string; effect: AgentAuditEffect }
  targets: AgentAuditTarget[]
  correlation: {
    conversationId?: string
    taskId?: string
    actionId?: string
    parentActionId?: string
    toolCallId?: string
  }
}

export type SourceGameEvent = AgentAuditMetadata & {
  type: string
  taskSeq?: number
  producer: AgentAuditProducer & { kind: 'game_plugin' }
  targets: [AgentAuditTarget, ...AgentAuditTarget[]]
  at: number
  data?: unknown
}

export function sourceEventKey(producer: Pick<AgentAuditProducer, 'id' | 'epoch' | 'sourceSeq'>): string {
  return `${producer.id}:${producer.epoch}:${producer.sourceSeq}`
}

export function isGameFactType(type: string): boolean {
  return type.startsWith('game.') || type.startsWith('navigation.')
}

export function classificationForEvent(type: string): AgentAuditMetadata['classification'] {
  if (isGameFactType(type)) return { domain: 'game_runtime', type, effect: type === 'agent.observation' ? 'read' : 'runtime_change' }
  if (type.startsWith('agent.')) return { domain: 'game_runtime', type, effect: 'read' }
  if (type.startsWith('tool.')) return { domain: 'game_runtime', type, effect: type === 'tool.started' ? 'read' : 'external_side_effect' }
  return { domain: 'system', type, effect: 'read' }
}
