'use client'

import { useEffect, useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Modal, ScrollArea, TextInput, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { cn } from '@/lib/utils'

import { refLink } from './CommonEventDetail'

type Props = {
  open: boolean
  title: string
  note: string
  /** `names.enemies` (id → translated name) */
  enemies: readonly string[]
  /** Shadow root of the in-game overlay; the page uses document.body */
  portalContainer?: Element | null
  onPick: (enemyId: number) => void
  onClose: () => void
}

const MAX_ROWS = 200

/** Search every enemy by id or name and pick one */
export function EnemyPicker({ open, title, note, enemies, portalContainer, onPick, onClose }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [showUnnamed, setShowUnnamed] = useState(false)
  useEffect(() => {
    if (open) return
    setQuery('')
    setShowUnnamed(false)
  }, [open])
  const { matches, more } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: Array<{ id: number; name: string }> = []
    for (let id = 1; id < enemies.length; id++) {
      const name = enemies[id] ?? ''
      if (!name && !showUnnamed) continue
      if (q && String(id) !== q && !name.toLowerCase().includes(q)) continue
      if (out.length === MAX_ROWS) return { matches: out, more: true }
      out.push({ id, name })
    }
    return { matches: out, more: false }
  }, [enemies, query, showUnnamed])

  return (
    <Modal open={open} title={title} description={note} onClose={onClose} portalContainer={portalContainer} panelClassName="w-[24rem] max-w-full">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <TextInput
            search
            className="min-w-0 flex-1"
            value={query}
            placeholder={t('events.troop.pickerSearch')}
            aria-label={t('events.troop.pickerSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            role="switch"
            aria-checked={showUnnamed}
            className={cn(filterToggle, 'shrink-0', showUnnamed && filterToggleOn)}
            onClick={() => setShowUnnamed(!showUnnamed)}
          >
            {t('events.troop.pickerShowUnnamed')}
          </button>
        </div>
        {matches.length ? (
          <ScrollArea className="h-[min(20rem,50vh)]" indicator="vertical" scrollProps={{ 'aria-label': t('events.troop.pickerAria') }}>
            <ul className="m-0 list-none p-0">
              {matches.map((e) => (
                <li key={e.id}>
                  <button type="button" className={refLink} onClick={() => onPick(e.id)}>
                    <span className="w-10 shrink-0 font-mono text-[0.72rem] text-ink-soft">#{e.id}</span>
                    <TruncateText text={e.name || t('events.unnamed', { id: e.id })} className={e.name ? 'text-ink' : 'text-ink-soft'} />
                  </button>
                </li>
              ))}
            </ul>
            {more ? <p className="m-0 px-2 py-2 text-[0.7rem] text-ink-soft">{t('events.troop.pickerMore', { max: MAX_ROWS })}</p> : null}
          </ScrollArea>
        ) : (
          <p className="m-0 py-6 text-center text-xs text-ink-soft">{t('events.troop.pickerEmpty')}</p>
        )}
      </div>
    </Modal>
  )
}
