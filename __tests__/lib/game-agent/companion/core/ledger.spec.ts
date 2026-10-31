import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { CompanionActionLedger } from '@/lib/game-agent/companion/core/ledger'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'

import { battleFrame } from './fixtures'

test('retiring an encounter cannot resurrect its unresolved commands', () => {
  const ledger = new CompanionActionLedger()
  const frame = battleFrame()
  const selection = chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN)
  if (selection.kind !== 'action') throw new Error('Expected action')
  ledger.startEncounter('old', 'g1', 'p1')
  ledger.recordPlanned({ ...selection.intent, encounterId: 'old' })
  ledger.recordCommitted(selection.intent.commandId)
  ledger.finishEncounter('old', 'win')
  expect(ledger.getPendingCommands()).toHaveLength(0)
  for (let index = 0; index < 200; index++) {
    ledger.startEncounter(`observed-${index}`, 'g1', 'p1')
    ledger.finishEncounter(`observed-${index}`, 'win')
    ledger.pruneOld()
  }
  expect(ledger.getEncounter('old')).toBeUndefined()
  expect(ledger.getPendingCommands()).toHaveLength(0)
  expect(ledger.getCommand(selection.intent.commandId)).toBeUndefined()
})

test('keeps a live unresolved command while pruning completed encounters', () => {
  const ledger = new CompanionActionLedger()
  const frame = battleFrame()
  const selection = chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN)
  if (selection.kind !== 'action') throw new Error('Expected action')
  ledger.startEncounter('live', 'g1', 'p1')
  ledger.recordPlanned({ ...selection.intent, encounterId: 'live' })
  ledger.recordUnknown(selection.intent.commandId)
  for (let index = 0; index < 10; index++) {
    ledger.startEncounter(`done-${index}`, 'g1', 'p1')
    ledger.finishEncounter(`done-${index}`, 'win')
  }
  ledger.pruneOld(2)
  expect(ledger.getPendingCommands().map((c) => c.commandId)).toEqual([selection.intent.commandId])
  expect(ledger.getEncounter('live')?.finishedAt).toBeUndefined()
})
