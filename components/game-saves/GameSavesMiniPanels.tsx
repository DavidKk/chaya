'use client'

import type { ReactNode } from 'react'
import { LuFolderOpen, LuSave } from 'react-icons/lu'

import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { MiniPanelAlert, MiniPanelBar, miniPanelIconButton, miniPanelIconClass, MiniPanelNotice } from '@/components/game-tools/MiniPanelParts'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea } from '@/components/sk'
import { autoEntries, type GameSaveEntry, type GameSaveList, quickSlots } from '@/lib/game/game-saves'

import { autoStatusText, useNow } from './auto-status'
import { formatFullTime, formatRelativeTime, saveTagLabel, saveTitle } from './format'
import type { useGameSaveActions } from './useGameSaveActions'
import type { useGameSaves } from './useGameSaves'

type Saves = ReturnType<typeof useGameSaves>
type Actions = ReturnType<typeof useGameSaveActions>

type PanelProps = {
  saves: Saves
  actions: Actions
  onClose: () => void
}

/** 面板正文：快照未就绪时显示读取中或失败原因 */
function Body({ saves, children }: { saves: Saves; children: ReactNode }) {
  const t = useT()
  if (saves.snapshot && saves.ready) return children
  return <MiniPanelNotice className={saves.error ? 'text-fail' : undefined}>{saves.error || t('saves.page.loading')}</MiniPanelNotice>
}

function EntryMeta({ entry, now }: { entry: GameSaveEntry; now: number }) {
  const t = useT()
  return (
    <div className="min-w-0 flex-1">
      <p className="m-0 truncate text-xs text-ink">{saveTitle(t, entry)}</p>
      <p className="m-0 truncate text-[0.68rem] text-ink-soft">
        {entry.list === 'auto' ? `${saveTagLabel(t, entry.tag)} · ` : ''}
        <time dateTime={new Date(entry.savedAt).toISOString()} title={formatFullTime(entry.savedAt)}>
          {formatRelativeTime(t, entry.savedAt, now)}
        </time>
        {entry.unsafe ? ` · ${t('saves.row.unsafe')}` : ''}
      </p>
    </div>
  )
}

/** 操作失败原因优先；否则提示该列表的存放位置暂不可用 */
function alertText(saves: Saves, list: GameSaveList, t: ReturnType<typeof useT>) {
  return saves.error || (saves.snapshot?.status.offline?.includes(list) ? t('saves.error.appOffline') : '')
}

function locked(saves: Saves, actions: Actions) {
  return !!actions.busyKey || !!saves.snapshot?.status.busy
}

function loading(saves: Saves, actions: Actions, entry: GameSaveEntry) {
  return actions.busyKey === `load:${entry.id}` || saves.snapshot?.status.busy?.entryId === entry.id
}

export function AutoSaveMiniPanel({ saves, actions, onClose }: PanelProps) {
  const { snapshot, settings, statusAt } = saves
  const now = useNow(true)
  const t = useT()
  const entries = snapshot ? autoEntries(snapshot.index) : []
  const busy = locked(saves, actions)
  return (
    <FloatingToolPanel title={t('saves.auto.title')} onClose={onClose} panel="autoSaves" scrollContent={false}>
      <div className="flex h-full min-h-0 flex-col">
        <Body saves={saves}>
          {snapshot ? (
            <MiniPanelBar summary={`${t('saves.auto.summary', { count: entries.length, max: settings.maxCount })} · ${autoStatusText(t, settings, snapshot, statusAt, now)}`}>
              <Button
                {...miniPanelIconButton}
                aria-label={t('saves.auto.saveNow')}
                onClick={() => void actions.saveAuto()}
                disabled={busy}
                loading={actions.busyKey === 'save:auto'}
              >
                <LuSave aria-hidden className={miniPanelIconClass} />
              </Button>
            </MiniPanelBar>
          ) : null}
          <MiniPanelAlert>{alertText(saves, 'auto', t)}</MiniPanelAlert>
          {entries.length ? (
            <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('saves.auto.listAria') }}>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                    <EntryMeta entry={entry} now={now} />
                    <Button
                      {...miniPanelIconButton}
                      aria-label={t('saves.row.load')}
                      onClick={() => void actions.load(entry)}
                      disabled={busy}
                      loading={loading(saves, actions, entry)}
                    >
                      <LuFolderOpen aria-hidden className={miniPanelIconClass} />
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <MiniPanelNotice>{t('saves.auto.empty')}</MiniPanelNotice>
          )}
        </Body>
      </div>
    </FloatingToolPanel>
  )
}

export function QuickSaveMiniPanel({ saves, actions, onClose }: PanelProps) {
  const { snapshot, settings } = saves
  const now = useNow(true)
  const t = useT()
  const slots = snapshot ? quickSlots(snapshot.index) : []
  const busy = locked(saves, actions)
  return (
    <FloatingToolPanel title={t('saves.quick.title')} onClose={onClose} panel="quickSaves" scrollContent={false}>
      <div className="flex h-full min-h-0 flex-col">
        <Body saves={saves}>
          {!settings.quickEnabled ? <MiniPanelBar summary={t('saves.quick.offNote')} /> : null}
          <MiniPanelAlert>{alertText(saves, 'quick', t)}</MiniPanelAlert>
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('saves.quick.listAria') }}>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {slots.map((entry, slot) => (
                <li key={slot} className="flex min-w-0 items-center gap-1 px-2 py-1.5">
                  <span className="w-6 shrink-0 text-xs font-semibold text-ink tabular-nums">#{slot}</span>
                  {entry ? <EntryMeta entry={entry} now={now} /> : <span className="min-w-0 flex-1 text-[0.7rem] text-ink-soft">{t('saves.quick.empty')}</span>}
                  <Button
                    {...miniPanelIconButton}
                    onClick={() => void actions.saveQuick(slot, !!entry)}
                    disabled={busy || !settings.quickEnabled}
                    loading={actions.busyKey === `quick:${slot}`}
                    aria-label={t('saves.quick.saveSlot', { slot })}
                  >
                    <LuSave aria-hidden className={miniPanelIconClass} />
                  </Button>
                  <Button
                    {...miniPanelIconButton}
                    onClick={() => entry && void actions.load(entry)}
                    disabled={busy || !entry}
                    loading={!!entry && loading(saves, actions, entry)}
                    aria-label={t('saves.quick.loadSlot', { slot })}
                  >
                    <LuFolderOpen aria-hidden className={miniPanelIconClass} />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </Body>
      </div>
    </FloatingToolPanel>
  )
}
