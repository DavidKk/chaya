import type { EventEffects, EventNames, EventRef, TroopInfo, TroopMember } from '@/lib/game/events'
import { groupTroopMembers, labelOf } from '@/lib/game/events'
import type { MessageKey, MessageParams } from '@/lib/i18n'

type T = (key: MessageKey, params?: MessageParams) => string

const MAX_LISTED = 5

function idList(ids: readonly number[], names: readonly string[]): string {
  const shown = ids.slice(0, MAX_LISTED).map((id) => labelOf(names, id))
  return ids.length > MAX_LISTED ? `${shown.join('、')}…` : shown.join('、')
}

export type EffectLabel = { text: string; risky: boolean }

/** Human-readable effect summary, risky items first */
export function effectLabels(effects: EventEffects, names: EventNames, t: T): EffectLabel[] {
  const out: EffectLabel[] = []
  const add = (text: string, risky = false) => out.push({ text, risky })
  const mapIds = effects.transfers.filter((id) => id > 0)
  if (mapIds.length) add(t('events.effTransfer', { list: idList(mapIds, names.maps) }), true)
  if (effects.transfers.includes(0)) add(t('events.effTransferVar'), true)
  if (effects.battle) add(t('events.effBattle'), true)
  if (effects.gameOver) add(t('events.effGameOver'), true)
  if (effects.title) add(t('events.effTitle'), true)
  if (effects.save) add(t('events.effSave'), true)
  if (effects.switches.length) add(t('events.effSwitches', { list: idList(effects.switches, names.switches) }))
  if (effects.variables.length) add(t('events.effVariables', { list: idList(effects.variables, names.variables) }))
  if (effects.selfSwitch) add(t('events.effSelf'))
  if (effects.gold) add(t('events.effGold'))
  if (effects.items) add(t('events.effItems'))
  if (effects.party) add(t('events.effParty'))
  if (effects.actorName) add(t('events.effActorName'))
  if (effects.script) add(t('events.effScript'))
  if (effects.plugin) add(t('events.effPlugin'))
  if (effects.calls.length) add(t('events.effCalls', { list: idList(effects.calls, names.commonEvents) }))
  return out
}

export function refLabel(ref: EventRef, names: EventNames, t: T): string {
  if (ref.kind === 'common') return t('events.refCommon', { target: labelOf(names.commonEvents, ref.id) })
  if (ref.kind === 'troop') return t('events.refTroop', { target: labelOf(names.troops, ref.id), page: ref.page ?? 1 })
  const event = ref.eventName ? `#${ref.eventId} ${ref.eventName}` : `#${ref.eventId}`
  return t('events.refMap', { map: labelOf(names.maps, ref.id), event, page: ref.page ?? 1 })
}

export function commonEventName(ev: { id: number; name: string }, t: T): string {
  return ev.name || t('events.unnamed', { id: ev.id })
}

const MAX_MEMBER_GROUPS = 3

/** "Slime ×2、Bat" (locale separator); more than three kinds end with "等" */
export function troopMemberSummary(members: readonly TroopMember[], t: T, max = MAX_MEMBER_GROUPS): string {
  if (!members.length) return t('events.troop.noMembers')
  const groups = groupTroopMembers(members)
  const shown = groups.slice(0, max).map((g) => `${g.name || `#${g.enemyId}`}${g.count > 1 ? ` ×${g.count}` : ''}`)
  const list = shown.join(t('events.troop.listSep'))
  return groups.length > max ? t('events.troop.summaryMore', { list }) : list
}

export function troopName(troop: Pick<TroopInfo, 'id' | 'name'> | undefined, id: number, t: T): string {
  return troop?.name || t('events.unnamed', { id })
}
