import { currentCompanionFacts } from '../../agent/runtime/companion-facts'
import { generateUuid } from '../../agent/runtime/companion-facts-helpers'

/** Serialization is also used for rollback backups; only the durable write is a save. */
export async function withCompanionSave<T>(kind: 'quick' | 'auto', slot: number | string, write: () => Promise<T>): Promise<T> {
  const facts = currentCompanionFacts()
  const stamp = facts?.stamp()
  const operationId = generateUuid('chaya-save')
  const notify = (phase: 'begin' | 'commit' | 'rollback') => {
    if (!facts || !stamp) return
    const current = facts.stamp()
    // A save finishing after an external load belongs to the earlier snapshot.
    if (current.contextEpoch !== stamp.contextEpoch || current.scope.segmentId !== stamp.scope.segmentId) return
    facts.onSaveLifecycle({ kind: 'save', operationId, phase, saveKind: kind, saveSlot: slot, at: Date.now() })
  }
  notify('begin')
  try {
    const result = await write()
    notify('commit')
    return result
  } catch (error) {
    notify('rollback')
    throw error
  }
}
