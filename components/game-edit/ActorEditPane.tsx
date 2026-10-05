'use client'

import { useEffect, useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell, formCardDense, formControlInline, formDescInline, formFieldInlineDense, formTitleInline, padXDense, padYDense } from '@/components/layoutClasses'
import { EmptyState, formatCompactNumber, formatExactNumber, NumberInput, ScrollArea, SegmentedNav, Select, SwitchToggle, TextInput, Tooltip, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import type { CatalogEntry } from '@/lib/game/game-edit-catalog-types'
import { cn } from '@/lib/utils'

import { LockEndAction } from './lock-ui'
import { ACTOR_PANES, type ActorPaneId } from './tabs'
import {
  ACTOR_PARAM_FIELDS,
  type ActorDraft,
  type ActorVitalLockKind,
  defaultActorDraft,
  hasCatalogName,
  lockKeyForActorSkill,
  lockKeyForActorState,
  lockKeyForActorVital,
  matchFilter,
} from './types'

type Props = {
  actors: CatalogEntry[]
  skills: CatalogEntry[]
  states: CatalogEntry[]
  classes: CatalogEntry[]
  filter: string
  onlyNamed: boolean
  setOnlyNamed: (onlyNamed: boolean) => void
  drafts: Record<number, ActorDraft>
  locks: Record<string, number>
  onOwnedLockChange: (kind: 'skills' | 'states', entryId: number, on: boolean) => void
  onVitalLockChange: (kind: ActorVitalLockKind, on: boolean) => void
  /** 三级：当前人物；null 表示尚未选中 */
  selectedId: number | null
  onSelectActor: (id: number) => void
  /** 四级：角色 / 状态 / 技能 */
  pane: ActorPaneId
  onPaneChange: (pane: ActorPaneId) => void
  onChange: (id: number, patch: Partial<ActorDraft>) => void
}

const listItem = cn(
  'flex w-full cursor-pointer items-center gap-2 border-b border-line text-left text-[0.8125rem] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
  padXDense,
  padYDense
)
const listItemOn = 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-ink'
/** 角色表单控件统一宽度 */
const fieldControl = 'w-[14rem]'

/** 与开关表同轨：ID / 名称 / 状态（Switch + 锁定） */
const ownedCols = 'grid-cols-[2.75rem_minmax(0,1fr)_max-content]'

const paramStepBtn = cn(
  'm-0 inline-flex h-[1.35rem] min-w-[1.75rem] cursor-pointer items-center justify-center rounded-[0.15rem] border-none bg-transparent px-1 font-mono text-[0.65rem] font-medium leading-none text-ink-soft',
  'hover:bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] hover:text-ink',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]'
)

const PARAM_STEPS = [-100, -1, 1, 100] as const

/** 标签 + 单一 NumberInput（输入与 ± 步进同框，对齐物品数值控件） */
function ParamRow({ label, value, min = 0, onSet }: { label: string; value: number; min?: number; onSet: (n: number) => void }) {
  function apply(n: number) {
    onSet(Math.max(min, Math.floor(n)))
  }

  return (
    <div className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-line last:border-b-0', padXDense, padYDense)}>
      <span className="text-[0.8125rem] font-medium text-ink">{label}</span>
      <div className="flex min-w-0 items-center justify-end">
        <NumberInput
          className={fieldControl}
          value={value}
          min={min}
          aria-label={label}
          onValueChange={(v) => apply(v)}
          endAction={
            <span className="inline-flex items-center gap-0.5">
              {PARAM_STEPS.map((d) => {
                const text = d > 0 ? `+${d}` : String(d)
                return (
                  <Tooltip key={d} content={text}>
                    <button type="button" className={paramStepBtn} aria-label={`${label} ${text}`} onClick={() => apply(value + d)}>
                      {text}
                    </button>
                  </Tooltip>
                )
              })}
            </span>
          }
        />
      </div>
    </div>
  )
}

/** 当前值；上限作 suffix 同框；过大数字紧凑展示，hover 看精确值 */
function CurrentVitalField({
  label,
  value,
  max,
  locked,
  onLockChange,
  onChange,
}: {
  label: 'HP' | 'MP'
  value: number
  max: number
  locked: boolean
  onLockChange: (on: boolean) => void
  onChange: (n: number) => void
}) {
  const t = useT()
  return (
    <div className={formFieldInlineDense}>
      <span className={formTitleInline}>{label}</span>
      <span className={formDescInline}>当前值</span>
      <div className={formControlInline}>
        <NumberInput
          className={fieldControl}
          value={value}
          min={0}
          aria-label={t('edit.currentOf', { label })}
          suffix={`/ ${formatCompactNumber(max)}`}
          tooltip={`${formatExactNumber(value)} / ${formatExactNumber(max)}`}
          endAction={<LockEndAction locked={locked} name={label} onChange={onLockChange} />}
          onValueChange={(v) => onChange(Math.max(0, Math.floor(v)))}
        />
      </div>
    </div>
  )
}

/** 角色：左选人（三级）+ 右详情导航人物 → 角色 / 状态 / 技能（四级） */
export function ActorEditPane({
  actors,
  skills,
  states,
  classes,
  filter,
  onlyNamed,
  setOnlyNamed,
  drafts,
  locks,
  onOwnedLockChange,
  onVitalLockChange,
  selectedId,
  onSelectActor,
  pane,
  onPaneChange,
  onChange,
}: Props) {
  const t = useT()
  const q = filter.trim().toLowerCase()
  const actorList = useMemo(() => {
    const out: CatalogEntry[] = []
    for (const entry of actors) {
      if (onlyNamed && !hasCatalogName(entry.name)) continue
      if (!matchFilter(`${entry.name} ${entry.id}`, q)) continue
      out.push(entry)
    }
    return out
  }, [actors, onlyNamed, q])

  const [listFilter, setListFilter] = useState('')
  const [showOwnedOnly, setShowOwnedOnly] = useState(false)

  useEffect(() => {
    if (actorList.length === 0) return
    if (selectedId != null && actorList.some((a) => a.id === selectedId)) return
    onSelectActor(actorList[0]!.id)
  }, [actorList, selectedId, onSelectActor])

  useEffect(() => {
    setListFilter('')
    setShowOwnedOnly(false)
  }, [pane])

  const selected = (selectedId != null ? actorList.find((a) => a.id === selectedId) : null) || null
  const draft = selected ? drafts[selected.id] || defaultActorDraft(selected.id, selected.name) : null

  const ownedSkill = new Set(draft?.skillIds || [])
  const ownedState = new Set(draft?.stateIds || [])

  const checkEntries = (() => {
    if (pane !== 'skills' && pane !== 'states') return []
    const src = pane === 'skills' ? skills : states
    const owned = pane === 'skills' ? ownedSkill : ownedState
    const sq = listFilter.trim().toLowerCase()
    return src.filter((e) => {
      if (onlyNamed && !hasCatalogName(e.name)) return false
      if (showOwnedOnly && !owned.has(e.id)) return false
      return matchFilter(`${e.name} ${e.description || ''} ${e.id}`, sq)
    })
  })()

  function patchSelected(patch: Partial<ActorDraft>) {
    if (!selected) return
    onChange(selected.id, patch)
  }

  function toggleOwned(kind: 'skills' | 'states', id: number, on: boolean) {
    if (!draft || !selected) return
    if (kind === 'skills') {
      const set = new Set(draft.skillIds)
      if (on) set.add(id)
      else set.delete(id)
      patchSelected({ skillIds: [...set].sort((a, b) => a - b) })
      return
    }
    const set = new Set(draft.stateIds)
    if (on) set.add(id)
    else set.delete(id)
    patchSelected({ stateIds: [...set].sort((a, b) => a - b) })
  }

  return (
    <div className="flex min-h-0 flex-1" role="region" aria-label={t('edit.actorEditAria')}>
      <aside className="flex w-[15rem] shrink-0 flex-col border-r border-line bg-paper-2 sm:w-[17rem]">
        <div className="shrink-0 border-b border-line px-3 py-2 text-[0.68rem] font-semibold tracking-[0.05em] text-ink-soft uppercase">人物 · {actorList.length}</div>
        {actorList.length === 0 ? (
          <EmptyState title={t('edit.actorNoMatchTitle')} message={t('edit.actorNoMatchMsg')} hint={t('edit.actorNoMatchHint')} />
        ) : (
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.actorListAria') }}>
            <ul className="m-0 list-none p-0">
              {actorList.map((entry) => {
                const on = entry.id === selectedId
                return (
                  <li key={entry.id}>
                    <button type="button" className={cn(listItem, on && listItemOn)} aria-current={on ? 'true' : undefined} onClick={() => onSelectActor(entry.id)}>
                      <TruncateText text={entry.name || t('edit.actorFallback', { id: entry.id })} className="font-medium text-ink" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!selected || !draft ? (
          <EmptyState title={t('edit.actorPickTitle')} message={t('edit.actorPickMsg')} />
        ) : (
          <>
            <div className="flex h-[3.25rem] shrink-0 items-center gap-1 border-b border-line px-4">
              <SegmentedNav items={ACTOR_PANES.map((item) => ({ id: item.id, label: t(item.labelKey) }))} value={pane} onChange={onPaneChange} aria-label={t('edit.category')} />
              {pane === 'states' || pane === 'skills' ? (
                <div className="ml-auto inline-flex shrink-0 items-center gap-2">
                  <TextInput
                    search
                    className="h-8 w-[11rem] max-w-[40vw] shrink-0 text-[0.8125rem]"
                    value={listFilter}
                    placeholder={t('edit.searchEllipsis')}
                    aria-label={pane === 'skills' ? t('edit.searchSkills') : t('edit.searchStates')}
                    onChange={(e) => setListFilter(e.target.value)}
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={onlyNamed}
                    aria-label={t('edit.onlyNamed')}
                    className={cn(filterToggle, onlyNamed && filterToggleOn)}
                    onClick={() => setOnlyNamed(!onlyNamed)}
                  >
                    {t('edit.onlyNamed')}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showOwnedOnly}
                    aria-label={t('edit.owned')}
                    className={cn(filterToggle, showOwnedOnly && filterToggleOn)}
                    onClick={() => setShowOwnedOnly((v) => !v)}
                  >
                    {t('edit.owned')}
                  </button>
                </div>
              ) : null}
            </div>

            {pane === 'actor' ? (
              <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.actorFormAria') }}>
                <div className="px-4 pt-3 pb-4">
                  <div className={cn(formCardDense, 'm-0 max-w-[32rem]')}>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.name')}</span>
                      <span className={formDescInline}>显示名</span>
                      <div className={formControlInline}>
                        <TextInput
                          className={cn('h-8 text-[0.8125rem]', fieldControl)}
                          value={draft.name}
                          aria-label={t('edit.name')}
                          onChange={(e) => patchSelected({ name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.nickname')}</span>
                      <span className={formDescInline}>可选</span>
                      <div className={formControlInline}>
                        <TextInput
                          className={cn('h-8 text-[0.8125rem]', fieldControl)}
                          value={draft.nickname}
                          aria-label={t('edit.nickname')}
                          onChange={(e) => patchSelected({ nickname: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.description')}</span>
                      <span className={formDescInline}>简介</span>
                      <div className={formControlInline}>
                        <TextInput
                          className={cn('h-8 text-[0.8125rem]', fieldControl)}
                          value={draft.profile}
                          aria-label={t('edit.description')}
                          onChange={(e) => patchSelected({ profile: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.class')}</span>
                      <span className={formDescInline}>Classes</span>
                      <div className={formControlInline}>
                        <Select
                          className={fieldControl}
                          value={String(draft.classId)}
                          aria-label={t('edit.class')}
                          options={(classes.length ? classes : [{ id: draft.classId, name: t('edit.classFallback', { id: draft.classId }) }]).map((c) => ({
                            value: String(c.id),
                            label: t('edit.classOpt', { id: c.id, name: c.name || t('edit.unnamed') }),
                          }))}
                          onChange={(v) => patchSelected({ classId: Math.max(1, Number(v) || 1) })}
                        />
                      </div>
                    </div>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.level')}</span>
                      <span className={formDescInline}>1 起</span>
                      <div className={formControlInline}>
                        <NumberInput
                          className={fieldControl}
                          value={draft.level}
                          min={1}
                          aria-label={t('edit.level')}
                          endAction={
                            <LockEndAction
                              locked={selectedId != null && lockKeyForActorVital('level', selectedId) in locks}
                              name={t('edit.level')}
                              onChange={(on) => onVitalLockChange('level', on)}
                            />
                          }
                          onValueChange={(v) => patchSelected({ level: Math.max(1, Math.floor(v)) })}
                        />
                      </div>
                    </div>
                    <div className={formFieldInlineDense}>
                      <span className={formTitleInline}>{t('edit.exp')}</span>
                      <span className={formDescInline}>当前经验值</span>
                      <div className={formControlInline}>
                        <NumberInput
                          className={fieldControl}
                          value={draft.exp}
                          min={0}
                          aria-label={t('edit.exp')}
                          endAction={
                            <LockEndAction
                              locked={selectedId != null && lockKeyForActorVital('exp', selectedId) in locks}
                              name={t('edit.exp')}
                              onChange={(on) => onVitalLockChange('exp', on)}
                            />
                          }
                          onValueChange={(v) => patchSelected({ exp: Math.max(0, Math.floor(v)) })}
                        />
                      </div>
                    </div>
                    <CurrentVitalField
                      label="HP"
                      value={draft.hp}
                      max={draft.mhp}
                      locked={selectedId != null && lockKeyForActorVital('hp', selectedId) in locks}
                      onLockChange={(on) => onVitalLockChange('hp', on)}
                      onChange={(n) => patchSelected({ hp: n })}
                    />
                    <CurrentVitalField
                      label="MP"
                      value={draft.mp}
                      max={draft.mmp}
                      locked={selectedId != null && lockKeyForActorVital('mp', selectedId) in locks}
                      onLockChange={(on) => onVitalLockChange('mp', on)}
                      onChange={(n) => patchSelected({ mp: n })}
                    />
                  </div>

                  <div className="mt-2 max-w-[32rem] overflow-hidden rounded-[0.35rem] border border-line bg-panel">
                    {ACTOR_PARAM_FIELDS.map((field) => {
                      const cur = Number(draft[field.key]) || 0
                      const min = field.key === 'mhp' ? 1 : 0
                      return <ParamRow key={field.key} label={field.label} value={cur} min={min} onSet={(n) => patchSelected({ [field.key]: n })} />
                    })}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {checkEntries.length === 0 ? (
                  <EmptyState title={t('edit.noMatchItems')} message={t('edit.noMatchItemsMsg')} />
                ) : (
                  <ScrollArea className="min-h-0 flex-1" indicator="both" scrollProps={{ 'aria-label': pane === 'skills' ? t('edit.skillsList') : t('edit.statesList') }}>
                    <div className="min-w-[36rem] text-[0.8125rem]" role="table" aria-label={pane === 'skills' ? t('edit.skillsTable') : t('edit.statesTable')}>
                      <div className={cn('sticky top-0 z-[3] grid items-center border-b border-line bg-paper-2', ownedCols)} role="row">
                        <div className={editHeadCell} role="columnheader">
                          ID
                        </div>
                        <div className={editHeadCell} role="columnheader">
                          名称
                        </div>
                        <div className={cn(editHeadCell, 'text-center')} role="columnheader">
                          {t('edit.colStatus')}
                        </div>
                      </div>
                      {checkEntries.map((entry, index) => {
                        const checked = pane === 'skills' ? ownedSkill.has(entry.id) : ownedState.has(entry.id)
                        const kind = pane === 'skills' ? 'skills' : 'states'
                        const name = entry.name || t('edit.unnamed')
                        const lockKey = selectedId == null ? '' : kind === 'skills' ? lockKeyForActorSkill(selectedId, entry.id) : lockKeyForActorState(selectedId, entry.id)
                        const locked = lockKey !== '' && lockKey in locks
                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              'grid items-center border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
                              ownedCols,
                              index === 0 && 'border-t-0'
                            )}
                            role="row"
                          >
                            <div className={cn(editCell, 'font-mono text-[0.75rem] text-ink-soft')} role="cell">
                              {entry.id}
                            </div>
                            <div className={cn(editCell, 'min-w-0')} role="cell">
                              {entry.description ? (
                                <div className="flex h-[2.35rem] min-w-0 flex-col justify-center gap-0.5">
                                  <TruncateText text={name} className="block font-medium leading-tight text-ink" />
                                  <TruncateText text={entry.description} className="block text-[0.7rem] leading-[1.35] text-ink-soft" />
                                </div>
                              ) : (
                                <div className="flex h-[2.35rem] min-w-0 items-center">
                                  <TruncateText text={name} className="block font-medium leading-tight text-ink" />
                                </div>
                              )}
                            </div>
                            <div className={cn(editCell, 'flex justify-center')} role="cell">
                              <span className="inline-flex items-center gap-2">
                                <SwitchToggle
                                  checked={checked}
                                  aria-label={pane === 'skills' ? t('edit.skillOf', { name }) : t('edit.stateOf', { name })}
                                  tooltip={checked ? t('edit.toggleOff', { name }) : t('edit.toggleOn', { name })}
                                  onCheckedChange={(on) => toggleOwned(kind, entry.id, on)}
                                />
                                <LockEndAction locked={locked} name={name} onChange={(on) => onOwnedLockChange(kind, entry.id, on)} />
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
