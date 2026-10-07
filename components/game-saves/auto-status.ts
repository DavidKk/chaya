'use client'

import { useEffect, useState } from 'react'

import { type GameSavesSettings, type GameSavesSnapshot, saveWaitReasonKey } from '@/lib/game/game-saves'

import { formatCountdown, type Translate } from './format'

/** 每秒刷新的当前时间，用于倒计时与相对时间 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/** 自动存档运行状态：倒计时、等待原因或进行中的操作 */
export function autoStatusText(t: Translate, settings: GameSavesSettings, snapshot: GameSavesSnapshot, statusAt: number, now: number): string {
  if (!settings.enabled) return t('saves.status.off')
  const { status } = snapshot
  if (status.busy) return t(status.busy.op === 'load' ? 'saves.status.loading' : 'saves.status.saving')
  if (status.waiting) return t('saves.status.waiting', { reason: t(saveWaitReasonKey(status.waiting)) })
  if (status.nextDueInMs == null) return t('saves.status.paused')
  if (!status.counting) return t('saves.status.inactive', { time: formatCountdown(status.nextDueInMs) })
  return t('saves.status.next', { time: formatCountdown(status.nextDueInMs - (now - statusAt)) })
}
