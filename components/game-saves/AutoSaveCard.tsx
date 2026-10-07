'use client'

import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { formControlInline, formDescInline, formTitleInline } from '@/components/layoutClasses'
import { Button, EmptyState, NumberSliderInput } from '@/components/sk'
import { SwitchToggle } from '@/components/sk/Switch'
import { formatBytes } from '@/lib/format-bytes'
import {
  AUTO_INTERVAL_MIN_RANGE,
  AUTO_MAX_COUNT_RANGE,
  autoEntries,
  type GameSaveEntry,
  type GameSavesSettings,
  type GameSavesSnapshot,
  summarizeGameSaves,
} from '@/lib/game/game-saves'

import { autoStatusText, useNow } from './auto-status'
import { GameSaveRow } from './GameSaveRow'
import { MiniPanelSwitchRow, type MiniPanelSwitchState } from './MiniPanelSwitch'
import { SaveCard, SaveListScroll, SaveListToolbar, settingsRow, settingsRows } from './SaveCard'
import { SaveStorageRow } from './SaveStorageRow'
import type { useGameSaveActions } from './useGameSaveActions'

type Props = {
  /** 通用设置；未连接也能修改 */
  settings: GameSavesSettings
  settingsReady: boolean
  /** 未连接或读取中为 null：列表与需要游戏执行的按钮不可用 */
  snapshot: GameSavesSnapshot | null
  statusAt: number
  actions: ReturnType<typeof useGameSaveActions>
  thumb: (entry: GameSaveEntry) => Promise<string | null>
  /** 游戏或页面有操作进行中 */
  locked: boolean
  /** 列表区域的替代内容（未连接、读取中、读取失败） */
  placeholder?: ReactNode
  miniPanel: MiniPanelSwitchState
}

export function AutoSaveCard({ settings, settingsReady, snapshot, statusAt, actions, thumb, locked, placeholder, miniPanel }: Props) {
  const entries = snapshot ? autoEntries(snapshot.index) : []
  const totals = snapshot ? summarizeGameSaves(snapshot.index) : null
  const now = useNow(settings.enabled && !!snapshot && !snapshot.status.waiting)
  const configuring = !settingsReady || actions.busyKey === 'configure'
  const t = useT()

  return (
    <SaveCard
      id="game-saves-auto"
      title={t('saves.auto.title')}
      description={t('saves.auto.desc')}
      hint={t('saves.auto.hint')}
      action={
        <SwitchToggle
          checked={settings.enabled}
          aria-label={t('saves.auto.enable')}
          tooltip={t(settings.enabled ? 'saves.auto.disable' : 'saves.auto.enable')}
          disabled={configuring}
          onCheckedChange={(enabled) => void actions.configure({ enabled })}
        />
      }
    >
      <div className={settingsRows}>
        <label className={settingsRow}>
          <span className={formTitleInline}>{t('saves.auto.interval')}</span>
          <span className={formDescInline}>{t('saves.auto.intervalDesc')}</span>
          <div className={formControlInline}>
            <NumberSliderInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={settings.intervalMin}
              min={AUTO_INTERVAL_MIN_RANGE.min}
              max={AUTO_INTERVAL_MIN_RANGE.max}
              suffix={t('saves.auto.minutes')}
              disabled={configuring}
              aria-label={t('saves.auto.intervalAria')}
              onValueChange={(intervalMin) => intervalMin !== settings.intervalMin && void actions.configure({ intervalMin })}
            />
          </div>
        </label>
        <label className={settingsRow}>
          <span className={formTitleInline}>{t('saves.auto.maxCount')}</span>
          <span className={formDescInline}>{t('saves.auto.maxCountDesc')}</span>
          <div className={formControlInline}>
            <NumberSliderInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={settings.maxCount}
              min={AUTO_MAX_COUNT_RANGE.min}
              max={AUTO_MAX_COUNT_RANGE.max}
              suffix={t('saves.auto.countUnit') || undefined}
              disabled={configuring}
              aria-label={t('saves.auto.maxCountAria')}
              onValueChange={(maxCount) => maxCount !== settings.maxCount && void actions.configure({ maxCount })}
            />
          </div>
        </label>
        <SaveStorageRow list="auto" settings={settings} disabled={configuring} appUnavailable={!!miniPanel.unavailable} onChange={(patch) => void actions.configure(patch)} />
        <MiniPanelSwitchRow state={miniPanel} field="autoSavePanelEnabled" label={t('saves.auto.panel')} />
      </div>
      {snapshot && totals && !placeholder ? (
        <SaveListToolbar
          summary={`${t('saves.auto.summary', { count: totals.autoCount, max: settings.maxCount })} · ${formatBytes(totals.autoBytes) ?? '0 B'} · ${autoStatusText(t, settings, snapshot, statusAt, now)}`}
        >
          <Button variant="accent" onClick={() => void actions.saveAuto()} disabled={locked} loading={actions.busyKey === 'save:auto'}>
            {t('saves.auto.saveNow')}
          </Button>
          <Button onClick={() => void actions.clear('auto')} disabled={locked || !entries.length}>
            {t('common.clear')}
          </Button>
        </SaveListToolbar>
      ) : null}
      {placeholder ??
        (entries.length ? (
          <SaveListScroll label={t('saves.auto.listAria')}>
            {entries.map((entry) => (
              <GameSaveRow
                key={entry.id}
                entry={entry}
                thumb={thumb}
                disabled={locked}
                loading={actions.busyKey === `load:${entry.id}` || snapshot?.status.busy?.entryId === entry.id}
                onLoad={() => void actions.load(entry)}
                onDelete={() => void actions.remove(entry)}
              />
            ))}
          </SaveListScroll>
        ) : (
          <EmptyState title={t('saves.auto.empty')} message={t(settings.enabled ? 'saves.auto.emptyOn' : 'saves.auto.emptyOff')} />
        ))}
    </SaveCard>
  )
}
