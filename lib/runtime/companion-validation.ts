import { COMPANION_REQUEST_TYPES, type CompanionHostRequest } from './companion-protocol'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const optionalIds = (value: unknown) => value === undefined || (Array.isArray(value) && value.length <= 64 && value.every((id) => integer(id, 1)))

function selection(value: Record<string, unknown>) {
  return (
    text(value.profileId, 160) &&
    text(value.model, 300) &&
    text(value.locale, 32) &&
    typeof value.character === 'string' &&
    ['nagi', 'rin', 'rei', 'koto', 'yui', 'towa'].includes(value.character)
  )
}

function stamp(value: unknown) {
  return (
    object(value) &&
    integer(value.contextEpoch) &&
    integer(value.factsRevision) &&
    object(value.scope) &&
    ['libraryGameId', 'dataRevision', 'playthroughId', 'runtimeInstanceId', 'segmentId'].every((key) => text(value.scope && (value.scope as Record<string, unknown>)[key], 500))
  )
}

/** Validate again at the authoritative host; requests can arrive without an HTTP adapter. */
export function isCompanionHostRequest(value: unknown): value is CompanionHostRequest {
  if (!object(value) || !text(value.requestId, 160) || typeof value.type !== 'string' || !COMPANION_REQUEST_TYPES.has(value.type)) return false
  switch (value.type) {
    case 'agent.companion.status':
    case 'agent.memory.clear':
      return true
    case 'agent.companion.route':
      return selection(value) && text(value.prompt, 2_000) && text(value.conversationId, 160)
    case 'agent.companion.chat':
      return selection(value) && text(value.prompt, 2_000) && text(value.conversationId, 160) && stamp(value.stamp)
    case 'agent.companion.cancel':
      return text(value.targetRequestId, 160)
    case 'agent.companion.control.start':
      return text(value.ticketId, 160)
    case 'agent.companion.events':
      return (
        integer(value.afterSeq) &&
        text(value.consumerId, 160) &&
        typeof value.visible === 'boolean' &&
        text(value.locale, 32) &&
        typeof value.character === 'string' &&
        ['nagi', 'rin', 'rei', 'koto', 'yui', 'towa'].includes(value.character) &&
        (value.conversationId === undefined || text(value.conversationId, 160))
      )
    case 'agent.memory.query': {
      if (value.filter === undefined) return true
      const filter = value.filter
      return (
        object(filter) &&
        optionalIds(filter.enemyIds) &&
        optionalIds(filter.skillIds) &&
        (filter.encounterId === undefined || text(filter.encounterId, 500)) &&
        (filter.segmentId === undefined || text(filter.segmentId, 500)) &&
        (filter.limit === undefined || integer(filter.limit, 1, 10)) &&
        (filter.intent === undefined || ['current_encounter', 'recent_death', 'rematch', 'explicit_history'].includes(String(filter.intent)))
      )
    }
    case 'agent.memory.settings': {
      if (!optionalBoolean(value.recording) || !optionalBoolean(value.naturalEnhancement)) return false
      if (value.preferences === undefined) return true
      const preferences = value.preferences
      return (
        object(preferences) &&
        Object.keys(preferences).every((key) => ['verbosity', 'spoilers', 'muteUntil'].includes(key)) &&
        (preferences.verbosity === undefined || ['quiet', 'normal', 'chatty'].includes(String(preferences.verbosity))) &&
        (preferences.spoilers === undefined || ['avoid', 'allow'].includes(String(preferences.spoilers))) &&
        (preferences.muteUntil === undefined || integer(preferences.muteUntil, 0, Date.now() + 30 * 24 * 60 * 60_000))
      )
    }
    default:
      return false
  }
}
