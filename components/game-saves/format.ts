import type { GameSaveEntry } from '@/lib/game/game-saves'
import type { MessageKey, MessageParams } from '@/lib/i18n'

/** `useT()` 或 `tNow` */
export type Translate = (key: MessageKey, params?: MessageParams) => string

const pad = (n: number) => String(n).padStart(2, '0')

/** 游戏时长 `时:分:秒`（按 60 帧/秒） */
export function formatPlaytime(frames: number): string {
  const total = Math.max(0, Math.floor(frames / 60))
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export function formatRelativeTime(t: Translate, at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at)
  if (diff < 60_000) return t('saves.time.justNow')
  if (diff < 3_600_000) return t('saves.time.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('saves.time.hoursAgo', { n: Math.floor(diff / 3_600_000) })
  if (diff < 30 * 86_400_000) return t('saves.time.daysAgo', { n: Math.floor(diff / 86_400_000) })
  return new Date(at).toLocaleDateString()
}

export function formatFullTime(at: number): string {
  return new Date(at).toLocaleString()
}

export function saveTitle(t: Translate, entry: GameSaveEntry): string {
  return entry.mapName.trim() || t('saves.mapFallback', { id: entry.mapId })
}

export function saveTagLabel(t: Translate, tag: GameSaveEntry['tag']): string {
  return t(`saves.tag.${tag}`)
}
