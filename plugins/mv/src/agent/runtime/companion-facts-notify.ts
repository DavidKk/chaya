/**
 * Companion Facts source-event constructor & notification dispatcher.
 */

import { type AgentRuntimeIdentity, sourceEventKey, type SourceGameEvent } from '@/lib/game-agent/audit'
import type { CompanionDomainEvent } from '@/lib/game-agent/companion/types'

import type { CompanionFactsListener } from './companion-facts'

export function dispatchFactEvent(
  domainEvent: CompanionDomainEvent,
  identity: AgentRuntimeIdentity,
  producerEpoch: number,
  sourceSeq: number,
  listeners: Set<CompanionFactsListener>
): void {
  const producer = {
    id: `${identity.pluginInstanceId}:companion-facts`,
    kind: 'game_plugin' as const,
    domain: 'game_runtime' as const,
    epoch: producerEpoch,
    sourceSeq,
  }

  const sourceEvent: SourceGameEvent = {
    schemaVersion: 2,
    eventId: sourceEventKey(producer),
    producer,
    execution: { host: 'game_plugin', component: 'companion-facts' },
    classification: {
      domain: 'game_runtime',
      type: `companion.${domainEvent.kind}`,
      effect: domainEvent.kind === 'action' ? 'runtime_change' : 'read',
    },
    targets: [
      {
        kind: 'runtime',
        id: identity.runtimeInstanceId,
        libraryGameId: identity.libraryGameId,
        runtimeInstanceId: identity.runtimeInstanceId,
        pluginInstanceId: identity.pluginInstanceId,
        connectionId: identity.connectionId,
      },
    ],
    correlation: {
      actionId: 'actionId' in domainEvent ? domainEvent.actionId : undefined,
    },
    type: `companion.${domainEvent.kind}`,
    at: domainEvent.at,
    data: domainEvent,
  }

  for (const listener of listeners) {
    try {
      listener(domainEvent, sourceEvent)
    } catch (err) {
      console.error('[CompanionFacts] Listener threw error:', err)
    }
  }
}
