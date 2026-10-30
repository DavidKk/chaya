'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { useSafeSearchParams } from '@/components/translate/safe-navigation'
import { cloudLibraryStorage, readCloudGameId } from '@/lib/browser/cloud-library'
import type { LibraryItemView } from '@/lib/game'
import { cn } from '@/lib/utils'

type StatusLite = {
  canUseDisk?: boolean
  ready?: boolean
  remote?: boolean
  config?: { gameRoot?: string }
  selected?: string
  library?: LibraryItemView[]
  nwPackage?: { name?: string; window?: { title?: string } } | null
}

/** 远程模式：`GameLinkProvider` 不开房间，本页连不上游戏 */
const REMOTE = Symbol('remote')

/** `null`：未选择游戏；空串：已选但读不到名字 */
type SelectedGame = string | null | typeof REMOTE

function rootsEqual(a: string, b: string) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}

async function readSelectedGame(gameId?: string | null): Promise<{ label: SelectedGame; id?: string }> {
  const url = gameId ? `/api/status?game=${encodeURIComponent(gameId)}` : '/api/status'
  const status = (await (await fetch(url)).json()) as StatusLite
  if (status.canUseDisk === false) {
    const id = readCloudGameId()
    if (!id) return { label: null }
    const entry = (await cloudLibraryStorage()).find((e) => e.item.id === id)?.item
    return { label: entry?.remark?.trim() || entry?.name?.trim() || '', id }
  }
  if (status.remote) return { label: REMOTE }
  if (!status.ready || (!status.selected && !status.config?.gameRoot)) return { label: null }
  const root = status.selected || status.config?.gameRoot
  const entry = (gameId ? status.library?.find((item) => item.id === gameId) : undefined) || (root ? status.library?.find((item) => rootsEqual(item.gameRoot, root)) : undefined)
  return {
    label: entry?.remark?.trim() || status.nwPackage?.window?.title?.trim() || entry?.name?.trim() || status.nwPackage?.name?.trim() || '',
    id: entry?.id || (gameId ?? undefined),
  }
}

/** 修改页顶栏：未选择（灰）/ 已选未连接（黄）/ 已连接（绿），点击去游戏库；远程模式不显示 */
export function LinkedGameBadge() {
  const t = useT()
  const searchParams = useSafeSearchParams()
  const urlGameId = searchParams?.get('game') || ''
  const { roomId, connected } = useGameLinkContext()
  const [game, setGame] = useState<SelectedGame>(null)
  const [resolvedId, setResolvedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readSelectedGame(urlGameId)
      .then((next) => {
        if (!cancelled) {
          setGame(next.label)
          setResolvedId(next.id || urlGameId || null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGame(null)
          setResolvedId(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [roomId, urlGameId])

  if (game === REMOTE) return null
  const state = connected ? 'linked' : game === null ? 'none' : 'offline'
  const label = state === 'none' ? t('edit.gameNone') : game || t('edit.gameUnnamed')
  const tip = state === 'linked' ? t('edit.gameLinkedTip') : state === 'offline' ? t('edit.gameOfflineTip') : t('edit.gameNoneTip')

  return (
    <Tooltip content={tip}>
      <Link
        href={resolvedId || urlGameId ? `/game?game=${encodeURIComponent(resolvedId || urlGameId)}` : '/game'}
        data-state={state}
        aria-label={`${label} · ${tip}`}
        className={cn(
          'inline-flex h-7 max-w-[12rem] min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[0.75rem] no-underline transition-colors',
          state === 'linked' && 'border-[color-mix(in_oklab,var(--ok)_45%,var(--line))] text-ink hover:border-ok',
          state === 'offline' && 'border-[color-mix(in_oklab,var(--warn)_45%,var(--line))] text-ink hover:border-warn',
          state === 'none' && 'border-line text-ink-soft hover:text-ink'
        )}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', state === 'linked' ? 'bg-ok' : state === 'offline' ? 'bg-warn' : 'bg-ink-soft')} aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
      </Link>
    </Tooltip>
  )
}
