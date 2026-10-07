'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { LuImage, LuTrash2 } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, Button } from '@/components/sk'
import type { GameSaveEntry } from '@/lib/game/game-saves'

import { formatFullTime, formatPlaytime, formatRelativeTime, saveTagLabel, saveTitle } from './format'

function Thumbnail({ entry, load }: { entry: GameSaveEntry; load: (entry: GameSaveEntry) => Promise<string | null> }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    void load(entry).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [entry, load])
  return (
    <div className="flex aspect-[4/3] w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-inset text-ink-soft">
      {src ? <div aria-hidden className="size-full bg-cover bg-center" style={{ backgroundImage: `url("${src}")` }} /> : <LuImage size={16} aria-hidden />}
    </div>
  )
}

type Props = {
  entry: GameSaveEntry
  thumb: (entry: GameSaveEntry) => Promise<string | null>
  /** 快速存档槽号前缀 */
  lead?: ReactNode
  disabled: boolean
  loading: boolean
  onLoad: () => void
  onDelete: () => void
  extra?: ReactNode
}

/** 一份存档：左侧缩略图与信息，右侧加载 / 删除 */
export function GameSaveRow({ entry, thumb, lead, disabled, loading, onLoad, onDelete, extra }: Props) {
  const t = useT()
  const title = saveTitle(t, entry)
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-2.5" aria-busy={loading || undefined}>
      {lead}
      <Thumbnail entry={entry} load={thumb} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          {entry.list === 'auto' ? (
            <Badge tone={entry.tag === 'preload' ? 'info' : entry.tag === 'manual' ? 'accent' : 'neutral'} dot={false}>
              {saveTagLabel(t, entry.tag)}
            </Badge>
          ) : null}
          {entry.unsafe ? (
            <Badge tone="warn" dot={false}>
              {t('saves.row.unsafe')}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 mb-0 flex flex-wrap gap-x-3 text-xs text-ink-soft">
          <span>{t('saves.row.playtime', { time: formatPlaytime(entry.playtimeFrames) })}</span>
          <time dateTime={new Date(entry.savedAt).toISOString()} title={formatFullTime(entry.savedAt)}>
            {formatRelativeTime(t, entry.savedAt)}
          </time>
          {entry.partyNames.length ? <span className="truncate">{entry.partyNames.join(t('saves.row.listSep'))}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="accent" onClick={onLoad} disabled={disabled} loading={loading}>
          {t('saves.row.load')}
        </Button>
        {extra}
        <Button size="icon" variant="ghost" aria-label={t('saves.row.delete', { title })} onClick={onDelete} disabled={disabled}>
          <LuTrash2 size={14} />
        </Button>
      </div>
    </div>
  )
}
