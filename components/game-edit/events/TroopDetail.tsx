'use client'

import { useState } from 'react'
import { IoArrowBack } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, Button, ScrollArea, SegmentedNav, Select, SwitchToggle, TruncateText } from '@/components/sk'
import { MAX_BATTLE_ENEMIES } from '@/lib/game/battle'
import { type CommonEventsData, countCommands, groupTroopMembers, labelOf, type TroopInfo } from '@/lib/game/events'

import { useBattleOptions } from './battle-options'
import { refLink, RefList, sectionTitle } from './CommonEventDetail'
import { EventScript } from './EventScript'
import { troopName } from './labels'
import { TroopBattleButton } from './TroopBattleButton'
import type { EventsSlot } from './types'

type Props = {
  troop: TroopInfo
  data: CommonEventsData
  slot: EventsSlot
  onBack: () => void
}

const COUNTS = Array.from({ length: MAX_BATTLE_ENEMIES }, (_, i) => i + 1)

/** Header, battle options, members, where it appears, callers and battle events of one troop */
export function TroopDetail({ troop, data, slot, onBack }: Props) {
  const t = useT()
  const [options, setOptions] = useBattleOptions()
  const [page, setPage] = useState(0)
  const name = troopName(troop, troop.id, t)
  const groups = groupTroopMembers(troop.members)
  const encounters = data.troopEncounters?.[troop.id] ?? []
  const refs = data.troopRefs?.[troop.id] ?? []
  const incomplete = !data.mapsScanned || data.mapsFailed > 0
  const pages = troop.pages.map((list, index) => ({ list, index })).filter((p) => countCommands(p.list) > 0)
  const shown = pages.find((p) => p.index === page) ?? pages[0]
  const countOptions = [{ value: '', label: t('events.troop.countOriginal') }, ...COUNTS.map((n) => ({ value: String(n), label: String(n) }))]

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('events.troop.detailAria')}>
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-3">
        <Button variant="ghost" size="icon" className="@4xl:hidden" aria-label={t('events.back')} tooltip={t('events.back')} onClick={onBack}>
          <IoArrowBack size={16} aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex min-w-0 text-[0.9rem] font-semibold text-ink">
            <TruncateText text={name} />
          </h2>
          <p className="m-0 flex min-w-0 text-[0.7rem] text-ink-soft">
            <TruncateText
              text={[troop.rawName && troop.rawName !== name ? troop.rawName : '', pages.length ? t('events.troop.pages', { count: pages.length }) : '']
                .filter(Boolean)
                .join(' · ')}
            />
          </p>
        </div>
        <TroopBattleButton troopId={troop.id} troop={troop} slot={slot} />
      </header>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('events.troop.detailAria') }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2 text-[0.8125rem]">
          <label className="flex items-center gap-2">
            <SwitchToggle checked={options.canEscape} aria-label={t('events.troop.canEscape')} onCheckedChange={(on) => setOptions({ canEscape: on })} />
            {t('events.troop.canEscape')}
          </label>
          <label className="flex items-center gap-2">
            <SwitchToggle checked={options.canLose} aria-label={t('events.troop.canLose')} onCheckedChange={(on) => setOptions({ canLose: on })} />
            {t('events.troop.canLose')}
          </label>
          <span className="flex items-center gap-2" title={t('events.troop.countHint')}>
            {t('events.troop.count')}
            <Select
              className="w-24"
              value={options.count == null ? '' : String(options.count)}
              options={countOptions}
              onChange={(value) => setOptions({ count: value ? Number(value) : null })}
              aria-label={t('events.troop.count')}
            />
          </span>
        </div>
        <h3 className={sectionTitle}>{t('events.troop.members')}</h3>
        {groups.length ? (
          <ul className="m-0 list-none px-3 pb-2 pl-3">
            {groups.map((g) => (
              <li key={g.enemyId} className="flex min-w-0 items-center gap-2 py-1 text-[0.8125rem]">
                <TruncateText text={g.name || `#${g.enemyId}`} className="text-ink" />
                {g.count > 1 ? <span className="shrink-0 font-mono text-[0.72rem] text-ink-soft">×{g.count}</span> : null}
                {g.hidden ? (
                  <Badge dot={false} tone="neutral" className="shrink-0">
                    {t('events.troop.memberHidden')}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-3 pb-2 text-xs text-ink-soft">{t('events.troop.noMembers')}</p>
        )}

        <h3 className={sectionTitle}>{t('events.troop.appearsIn')}</h3>
        {incomplete ? <p className="m-0 px-3 pb-1 text-[0.7rem] text-warn">{t('events.refsIncomplete')}</p> : null}
        {encounters.length ? (
          <ul className="m-0 list-none px-1 pb-2 pl-1">
            {encounters.map((e, index) => (
              <li key={`${e.mapId}-${index}`}>
                <button type="button" className={refLink} onClick={() => slot.onSelectMap(e.mapId, null)}>
                  <TruncateText text={labelOf(data.names.maps, e.mapId)} className="min-w-0 flex-1" />
                  <span className="ml-2 shrink-0 font-mono text-[0.72rem] text-ink-soft">
                    {[e.regionSet.length ? t('events.troop.regions', { list: e.regionSet.join(t('events.troop.listSep')) }) : '', t('events.troop.weight', { weight: e.weight })]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-3 pb-2 text-xs text-ink-soft">{t('events.troop.appearsNone')}</p>
        )}

        <h3 className={sectionTitle}>{t('events.troop.calledBy')}</h3>
        {refs.length ? <RefList refs={refs} data={data} slot={slot} /> : <p className="m-0 px-3 pb-2 text-xs text-ink-soft">{t('events.troop.calledNone')}</p>}

        <h3 className={sectionTitle}>
          {t('events.troop.battleEvents')} · {t('events.commands', { count: troop.commandCount })}
        </h3>
        {pages.length > 1 ? (
          <div className="px-3 py-2">
            <SegmentedNav
              items={pages.map((p) => ({ id: String(p.index), label: t('events.troop.pageTab', { n: p.index + 1 }) }))}
              value={String(shown?.index ?? 0)}
              onChange={(id) => setPage(Number(id))}
              aria-label={t('events.troop.pagesAria')}
            />
          </div>
        ) : null}
        {shown ? (
          <EventScript
            key={shown.index}
            list={shown.list}
            names={data.names}
            texts={data.texts}
            onOpenCommon={(id) => slot.onSelectCommon(id)}
            onOpenMap={(id) => slot.onSelectMap(id, null)}
          />
        ) : (
          <p className="m-0 px-3 pb-3 text-xs text-ink-soft">{t('events.troop.battleEventsNone')}</p>
        )}
      </ScrollArea>
    </section>
  )
}
