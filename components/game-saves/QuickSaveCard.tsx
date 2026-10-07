'use client'

import type { ReactNode } from 'react'
import { LuArrowRight } from 'react-icons/lu'

import { displayKeyChord, requestHotkeyGroupFocus } from '@/components/game-edit/run-hotkeys'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { SwitchToggle } from '@/components/sk/Switch'
import { formatBytes } from '@/lib/format-bytes'
import { type GameSaveEntry, type GameSavesSettings, type GameSavesSnapshot, QUICK_SLOT_COUNT, quickSlots, summarizeGameSaves } from '@/lib/game/game-saves'

import type { Translate } from './format'
import { GameSaveRow } from './GameSaveRow'
import { MiniPanelSwitchRow, type MiniPanelSwitchState } from './MiniPanelSwitch'
import { SaveCard, SaveListScroll, SaveListToolbar, settingsRows } from './SaveCard'
import { SaveStorageRow } from './SaveStorageRow'
import type { useGameSaveActions } from './useGameSaveActions'

export type QuickSlotHotkeys = { save?: string; load?: string }

type Props = {
  /** 通用设置；未连接也能修改 */
  settings: GameSavesSettings
  settingsReady: boolean
  /** 未连接或读取中为 null：槽位与需要游戏执行的按钮不可用 */
  snapshot: GameSavesSnapshot | null
  actions: ReturnType<typeof useGameSaveActions>
  thumb: (entry: GameSaveEntry) => Promise<string | null>
  locked: boolean
  /** 每个槽的快速保存 / 读取快捷键；只用于设置区的示例说明 */
  hotkeys?: readonly QuickSlotHotkeys[]
  /** 槽位列表的替代内容（未连接、读取中、读取失败） */
  placeholder?: ReactNode
  /** 跳到「辅助 › 快捷键」；Web 走路由，局内浮层切换分区 */
  onOpenHotkeys?: () => void
  miniPanel: MiniPanelSwitchState
}

function SlotLead({ slot }: { slot: number }) {
  return <span className="w-8 shrink-0 text-sm font-semibold text-ink tabular-nums">#{slot}</span>
}

function hotkeyExample(t: Translate, hotkeys: readonly QuickSlotHotkeys[] | undefined): string {
  const save = hotkeys?.[1]?.save
  const load = hotkeys?.[1]?.load
  const example = [save && t('saves.quick.exampleSave', { key: displayKeyChord(save) }), load && t('saves.quick.exampleLoad', { key: displayKeyChord(load) })]
    .filter(Boolean)
    .join(t('saves.quick.exampleJoin'))
  return example ? t('saves.quick.hotkeyHintExample', { example }) : t('saves.quick.hotkeyHint')
}

export function QuickSaveCard({ settings, settingsReady, snapshot, actions, thumb, locked, hotkeys, placeholder, onOpenHotkeys, miniPanel }: Props) {
  const slots = snapshot ? quickSlots(snapshot.index) : []
  const totals = snapshot ? summarizeGameSaves(snapshot.index) : null
  const t = useT()

  return (
    <SaveCard
      id="game-saves-quick"
      title={t('saves.quick.title')}
      description={t('saves.quick.desc')}
      hint={t('saves.quick.hint')}
      action={
        <SwitchToggle
          checked={settings.quickEnabled}
          aria-label={t('saves.quick.enable')}
          tooltip={t(settings.quickEnabled ? 'saves.quick.disable' : 'saves.quick.enable')}
          disabled={!settingsReady || actions.busyKey === 'configure'}
          onCheckedChange={(quickEnabled) => void actions.configure({ quickEnabled })}
        />
      }
    >
      <div className={settingsRows}>
        <SaveStorageRow
          list="quick"
          settings={settings}
          disabled={!settingsReady || actions.busyKey === 'configure'}
          appUnavailable={!!miniPanel.unavailable}
          onChange={(patch) => void actions.configure(patch)}
        />
        <MiniPanelSwitchRow state={miniPanel} field="quickSavePanelEnabled" label={t('saves.quick.panel')} />
        {onOpenHotkeys ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 text-xs text-ink-soft">{hotkeyExample(t, hotkeys)}</span>
            <Button
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                requestHotkeyGroupFocus('edit.groupQuickSave')
                onOpenHotkeys()
              }}
            >
              {t('saves.quick.configureHotkeys')}
              <LuArrowRight aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      {totals && !placeholder ? (
        <SaveListToolbar summary={`${t('saves.quick.summary', { used: totals.quickUsed, total: QUICK_SLOT_COUNT })} · ${formatBytes(totals.quickBytes) ?? '0 B'}`}>
          <Button onClick={() => void actions.clear('quick')} disabled={locked || !totals.quickUsed}>
            {t('common.clear')}
          </Button>
        </SaveListToolbar>
      ) : null}
      {placeholder ?? (
        <SaveListScroll label={t('saves.quick.listAria')}>
          {slots.map((entry, slot) => {
            const saving = actions.busyKey === `quick:${slot}`
            const saveButton = (
              <Button
                onClick={() => void actions.saveQuick(slot, !!entry)}
                disabled={locked || !settings.quickEnabled}
                loading={saving}
                aria-label={t('saves.quick.saveSlot', { slot })}
              >
                {t('saves.quick.save')}
              </Button>
            )
            if (!entry)
              return (
                <div key={slot} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                  <SlotLead slot={slot} />
                  <span className="flex-1 text-xs text-ink-soft">{t('saves.quick.empty')}</span>
                  {saveButton}
                </div>
              )
            return (
              <GameSaveRow
                key={slot}
                entry={entry}
                thumb={thumb}
                lead={<SlotLead slot={slot} />}
                disabled={locked}
                loading={actions.busyKey === `load:${entry.id}` || snapshot?.status.busy?.entryId === entry.id}
                onLoad={() => void actions.load(entry)}
                onDelete={() => void actions.remove(entry)}
                extra={saveButton}
              />
            )
          })}
        </SaveListScroll>
      )}
    </SaveCard>
  )
}
