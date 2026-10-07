'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { TruncateText } from '@/components/sk'
import { type CommonEventsData, encounterShares, type MapDetailData } from '@/lib/game/events'

import { sectionTitle } from './CommonEventDetail'
import { troopMemberSummary, troopName } from './labels'
import { TroopBattleButton } from './TroopBattleButton'
import type { EventsSlot } from './types'

type Props = {
  detail: MapDetailData
  data: CommonEventsData
  slot: EventsSlot
}

/** Random encounters of one map; hidden when the list is empty */
export function MapEncounters({ detail, data, slot }: Props) {
  const t = useT()
  const encounters = detail.encounters ?? []
  if (!encounters.length) return null
  const shares = encounterShares(encounters)
  const notCurrent = slot.player?.mapId === detail.mapId ? '' : t('events.troop.notCurrentMap')

  return (
    <section className="border-b border-line pb-1" aria-label={t('events.troop.encounters')}>
      <h3 className={sectionTitle}>
        {t('events.troop.encounters')}
        {detail.encounterStep > 0 ? <span className="ml-2 font-normal tracking-normal normal-case">{t('events.troop.encounterStep', { steps: detail.encounterStep })}</span> : null}
      </h3>
      <ul className="m-0 list-none px-1 pl-1">
        {encounters.map((e, index) => {
          const troop = data.troops?.find((item) => item.id === e.troopId)
          const name = troopName(troop, e.troopId, t)
          const share = shares[index]
          const chance =
            share != null
              ? t('events.troop.share', { percent: Math.round(share * 1000) / 10 })
              : [e.regionSet.length ? t('events.troop.regions', { list: e.regionSet.join(t('events.troop.listSep')) }) : '', t('events.troop.weight', { weight: e.weight })]
                  .filter(Boolean)
                  .join(' · ')
          return (
            <li
              key={`${e.troopId}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-[0.2rem] px-2 py-1 text-[0.8125rem] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
            >
              <button
                type="button"
                className="m-0 flex min-w-0 flex-1 cursor-pointer flex-col items-start border-none bg-transparent p-0 text-left"
                aria-label={t('events.troop.openTroop', { name })}
                onClick={() => slot.onSelectTroop(e.troopId)}
              >
                <TruncateText text={name} className="font-medium text-ink underline-offset-2 hover:underline" />
                <TruncateText text={troop ? troopMemberSummary(troop.members, t) : ''} className="text-[0.7rem] text-ink-soft" />
              </button>
              <span className="shrink-0 font-mono text-[0.72rem] text-ink-soft">{chance}</span>
              <TroopBattleButton troopId={e.troopId} troop={troop} slot={slot} label={t('events.troop.encounterNow')} blocked={notCurrent} compact />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
