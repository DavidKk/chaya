'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cloudLibraryStorage, readCloudGameId } from '@/lib/browser/cloud-library'
import type { LibraryItemView } from '@/lib/game'
import { cn } from '@/lib/utils'

type StatusLite = {
  canUseDisk?: boolean
  ready?: boolean
  config?: { gameRoot?: string }
  library?: LibraryItemView[]
  nwPackage?: { name?: string; window?: { title?: string } } | null
}

/** `null`：未选择游戏；空串：已选但读不到名字 */
type SelectedGame = string | null

function rootsEqual(a: string, b: string) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}

async function readSelectedGame(): Promise<SelectedGame> {
  const status = (await (await fetch('/api/status')).json()) as StatusLite
  if (status.canUseDisk === false) {
    const id = readCloudGameId()
    if (!id) return null
    const entry = (await cloudLibraryStorage()).find((e) => e.item.id === id)?.item
    return entry?.remark?.trim() || entry?.name?.trim() || ''
  }
  if (!status.ready || !status.config?.gameRoot) return null
  const root = status.config.gameRoot
  const entry = status.library?.find((item) => rootsEqual(item.gameRoot, root))
  return entry?.remark?.trim() || status.nwPackage?.window?.title?.trim() || entry?.name?.trim() || status.nwPackage?.name?.trim() || ''
}

/** 修改页顶栏：未选择（灰）/ 已选未连接（黄）/ 已连接（绿），点击去游戏库 */
export function LinkedGameBadge() {
  const t = useT()
  const { roomId, connected } = useGameLinkContext()
  const [game, setGame] = useState<SelectedGame>(null)

  useEffect(() => {
    let cancelled = false
    readSelectedGame()
      .then((next) => {
        if (!cancelled) setGame(next)
      })
      .catch(() => {
        if (!cancelled) setGame(null)
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  const state = connected ? 'linked' : game === null ? 'none' : 'offline'
  const label = state === 'none' ? t('edit.gameNone') : game || t('edit.gameUnnamed')
  const tip = state === 'linked' ? t('edit.gameLinkedTip') : state === 'offline' ? t('edit.gameOfflineTip') : t('edit.gameNoneTip')

  return (
    <Tooltip content={tip}>
      <Link
        href="/game"
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
