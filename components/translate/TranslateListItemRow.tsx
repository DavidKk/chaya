'use client'

import React, { memo, useEffect, useState } from 'react'
import { LiaMapMarkedAltSolid } from 'react-icons/lia'
import { LuFileText, LuKey, LuUser } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { PlainTextEditor, Spinner, Tooltip } from '@/components/sk'
import { cn } from '@/lib/utils'
import type { ExtractedTextCategory, ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

export const CATEGORY_STYLES: Record<ExtractedTextCategory, { label: string; badgeClass: string }> = {
  dialogue: { label: '对话', badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  story: { label: '剧情/旁白', badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  choice: { label: '选项', badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  item: { label: '物品', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  item_desc: { label: '物品说明', badgeClass: 'bg-amber-500/10 text-amber-400/90 border-amber-500/20' },
  weapon: { label: '武器', badgeClass: 'bg-red-500/15 text-red-300 border-red-500/30' },
  weapon_desc: { label: '武器说明', badgeClass: 'bg-red-500/10 text-red-400/90 border-red-500/20' },
  armor: { label: '防具', badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  armor_desc: { label: '防具说明', badgeClass: 'bg-blue-500/10 text-blue-400/90 border-blue-500/20' },
  skill: { label: '技能', badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  skill_desc: { label: '技能说明', badgeClass: 'bg-purple-500/10 text-purple-400/90 border-purple-500/20' },
  actor: { label: '角色名', badgeClass: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  actor_nickname: { label: '角色称号', badgeClass: 'bg-pink-500/10 text-pink-300/80 border-pink-500/20' },
  actor_profile: { label: '角色背景', badgeClass: 'bg-pink-500/10 text-pink-300/80 border-pink-500/20' },
  enemy: { label: '敌人', badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  state: { label: '状态', badgeClass: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  state_msg: { label: '状态提示', badgeClass: 'bg-yellow-500/10 text-yellow-400/80 border-yellow-500/20' },
  map: { label: '地名', badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  system: { label: '系统文案', badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  plugin: { label: '插件参数', badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  resource: { label: '文本资源', badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  other: { label: '其他文本', badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
}

const CATEGORY_I18N_KEYS: Partial<Record<ExtractedTextCategory, string>> = {
  dialogue: 'catDialogue',
  story: 'catStory',
  choice: 'catChoice',
  item: 'catItem',
  item_desc: 'catItemDesc',
  weapon: 'catWeapon',
  weapon_desc: 'catWeaponDesc',
  armor: 'catArmor',
  armor_desc: 'catArmorDesc',
  skill: 'catSkill',
  skill_desc: 'catSkillDesc',
  actor: 'catActor',
  actor_nickname: 'catActorNickname',
  actor_profile: 'catActorProfile',
  enemy: 'catEnemy',
  state: 'catState',
  state_msg: 'catStateMsg',
  map: 'catMap',
  system: 'catSystem',
  plugin: 'catPlugin',
  resource: 'catResource',
  other: 'catOther',
}

export type AvailableEngine = {
  id: string
  label: string
  group: 'agent' | 'platform' | 'system'
}

export type TranslateListItemRowProps = {
  item: ExtractedTranslationItem
  itemZh?: string
  savedZh?: string
  activeSchemeLabel: string
  isTranslating: boolean
  isSaving: boolean
  isResetting: boolean
  onTranslate: (item: ExtractedTranslationItem) => void
  onSave: (item: ExtractedTranslationItem) => void
  onReset: (item: ExtractedTranslationItem) => void
  onUpdate: () => void
}

export const TranslateListItemRow = memo(function TranslateListItemRow({
  item,
  itemZh,
  savedZh: _savedZh,
  activeSchemeLabel,
  isTranslating,
  isSaving,
  isResetting,
  onTranslate,
  onSave,
  onReset,
  onUpdate,
}: TranslateListItemRowProps) {
  const t = useT()
  const [currentZh, setCurrentZh] = useState(item.zh)

  useEffect(() => {
    setCurrentZh(item.zh)
  }, [item.zh, itemZh])

  const catInfo = CATEGORY_STYLES[item.meta.category] || { label: item.meta.label || '文本', badgeClass: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30' }
  const catKey = CATEGORY_I18N_KEYS[item.meta.category]
  const catLabel = catKey ? t(`translate.${catKey}` as any) : item.meta.label || catInfo.label
  const hasSavedVersion = Boolean(item.savedZh && item.savedZh.trim())
  const originalText = item.initialZh ?? item.savedZh ?? ''
  const canReset = Boolean(originalText && (currentZh !== originalText || hasSavedVersion))

  return (
    <div className="flex h-[150px] flex-col min-w-0">
      {/* 1. Header Toolbar: Index, Category Badge, Speaker, Context, Reset (Left) | Translate + Save (Right) */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-4 border-b border-line bg-surface/20 text-xs">
        {/* Left: Metadata info + Reset button */}
        <div className="flex items-center gap-2 overflow-hidden">
          <Tooltip content={t('translate.listRowItemIndex', { id: item.id })} placement="top">
            <span className="shrink-0 font-mono text-[0.6875rem] text-ink-soft select-none cursor-default">#{item.id}</span>
          </Tooltip>
          {item.meta.localesKey ? (
            <Tooltip
              content={`${t('translate.listRowLocalesKey', { key: item.meta.localesKey })}${item.meta.localesFile ? t('translate.listRowLocalesFile', { file: item.meta.localesFile }) : ''}`}
              placement="top"
            >
              <button
                type="button"
                onClick={() => {
                  if (item.meta.localesKey) {
                    navigator.clipboard?.writeText(item.meta.localesKey)
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.6875rem] font-mono text-accent hover:bg-accent/20 transition-colors cursor-pointer outline-none"
                title={t('translate.listRowCopyKeyTitle')}
              >
                <LuKey size={11} className="shrink-0" />
                <span className="max-w-[120px] truncate">{item.meta.localesKey}</span>
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={t('translate.listRowCategoryTooltip', { category: catLabel })} placement="top">
            <span className={cn('shrink-0 rounded-[0.2rem] border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none cursor-default', catInfo.badgeClass)}>{catLabel}</span>
          </Tooltip>
          {item.meta.file ? (
            <Tooltip content={t('translate.listRowFileTooltip', { file: item.meta.file })} placement="top">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] bg-inset px-1.5 py-0.5 text-[0.6875rem] text-ink-soft select-all cursor-default">
                <LuFileText size={11} className="shrink-0 text-accent" />
                <span>{item.meta.file}</span>
              </span>
            </Tooltip>
          ) : null}
          {item.meta.speaker ? (
            <Tooltip content={t('translate.listRowSpeakerTooltip', { speaker: item.meta.speaker })} placement="top">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] bg-inset px-1.5 py-0.5 text-[0.6875rem] text-ink-soft select-all cursor-default">
                <LuUser size={11} className="shrink-0 text-accent" />
                <span>{item.meta.speaker}</span>
              </span>
            </Tooltip>
          ) : null}
          {item.meta.context && item.meta.context !== item.meta.file && item.meta.context !== item.src ? (
            <Tooltip content={t('translate.listRowContextTooltip', { context: item.meta.context })} placement="top">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] bg-inset px-1.5 py-0.5 text-[0.6875rem] text-ink-soft select-all cursor-default">
                <LiaMapMarkedAltSolid size={12} className="shrink-0 text-accent" />
                <span>{item.meta.context}</span>
              </span>
            </Tooltip>
          ) : null}
        </div>

        {/* Right: Reset (if modified / saved) + Translate with Hover Dropdown + Save */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Reset Button (placed on right side, reverts to original text without saving) */}
          {canReset ? (
            <Tooltip content={t('translate.listSingleResetTooltip')} placement="top">
              <span className="inline-flex">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={() => {
                    onReset(item)
                    setCurrentZh(item.initialZh ?? item.savedZh ?? '')
                  }}
                  className="inline-flex h-6 items-center justify-center rounded-[0.2rem] border border-fail/40 bg-fail/10 px-2 text-[0.6875rem] font-medium text-fail hover:bg-fail/20 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isResetting ? <Spinner size="sm" /> : null}
                  {t('translate.listResetPageBtn')}
                </button>
              </span>
            </Tooltip>
          ) : null}

          {/* Translate Button */}
          <Tooltip content={isTranslating ? t('translate.listSingleTransTranslating') : t('translate.listSingleTransTooltip', { scheme: activeSchemeLabel })} placement="top">
            <span className="inline-flex">
              <button
                type="button"
                disabled={isTranslating}
                onClick={() => onTranslate(item)}
                className="inline-flex h-6 items-center justify-center rounded-[0.2rem] bg-accent px-2.5 text-[0.6875rem] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {isTranslating ? <Spinner size="sm" /> : null}
                {t('translate.listSingleTransBtn')}
              </button>
            </span>
          </Tooltip>

          {/* Save Button */}
          <Tooltip
            content={isSaving ? t('translate.listSingleSaving') : !currentZh || !currentZh.trim() ? t('translate.listSingleSaveEmpty') : t('translate.listSingleSaveTooltip')}
            placement="top"
          >
            <span className="inline-flex">
              <button
                type="button"
                disabled={isSaving || !currentZh || !currentZh.trim()}
                onClick={() => onSave(item)}
                className="inline-flex h-6 items-center justify-center rounded-[0.2rem] bg-ok px-2 text-[0.6875rem] font-medium text-white hover:bg-ok/90 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSaving ? <Spinner size="sm" /> : null}
                {t('translate.listSingleSaveBtn')}
              </button>
            </span>
          </Tooltip>
        </div>
      </div>

      {/* 2. Content: Two seamless editors connected side-by-side, no inner padding, no outer margins */}
      <div className="grid grid-cols-2 flex-1 min-h-0 min-w-0">
        {/* Left Column: Original Editor (Darker, read-only, right border divider, bottom border as row divider) */}
        <div className="flex flex-col min-w-0 h-full">
          <PlainTextEditor
            value={item.src}
            disabled
            softWrap
            fill
            noScrollbars
            className="h-full rounded-none border-0 border-r border-b border-line bg-black/40 [&_.monaco-editor]:!bg-transparent [&_.monaco-editor-background]:!bg-transparent [&_.margin]:!bg-transparent"
            aria-label={t('translate.listRowItemAriaSrc', { id: item.id })}
          />
        </div>

        {/* Right Column: Translated Editor (Lighter, interactive, bottom border highlights on focus) */}
        <div className="flex flex-col min-w-0 h-full">
          <PlainTextEditor
            value={currentZh}
            disabled={isTranslating}
            softWrap
            fill
            noScrollbars
            className="h-full rounded-none border-0 border-b border-line bg-panel/35 focus-within:border-b-accent focus-within:bg-panel/60 transition-colors [&_.monaco-editor]:!bg-transparent [&_.monaco-editor-background]:!bg-transparent [&_.margin]:!bg-transparent"
            aria-label={t('translate.listRowItemAriaZh', { id: item.id })}
            onChange={(val) => {
              item.zh = val
              setCurrentZh(val)
              onUpdate()
            }}
          />
        </div>
      </div>
    </div>
  )
})
