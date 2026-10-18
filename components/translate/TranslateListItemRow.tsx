'use client'

import { Menu } from '@base-ui/react/menu'
import React, { memo, useMemo } from 'react'
import { LiaMapMarkedAltSolid } from 'react-icons/lia'
import { LuCheck, LuChevronDown, LuFileText, LuKey, LuUser } from 'react-icons/lu'

import { PlainTextEditor, Spinner, Tooltip } from '@/components/sk'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'
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

export type AvailableEngine = {
  id: string
  label: string
  group: 'agent' | 'platform' | 'system'
}

export type TranslateListItemRowProps = {
  item: ExtractedTranslationItem
  activeSchemeLabel: string
  selectedScheme: string
  availableEngines: AvailableEngine[]
  isTranslating: boolean
  isSaving: boolean
  isResetting: boolean
  onTranslate: (item: ExtractedTranslationItem, scheme?: string) => void
  onSave: (item: ExtractedTranslationItem) => void
  onReset: (item: ExtractedTranslationItem) => void
  onSelectScheme: (scheme: string) => void
  onUpdate: () => void
}

export const TranslateListItemRow = memo(function TranslateListItemRow({
  item,
  activeSchemeLabel,
  selectedScheme,
  availableEngines,
  isTranslating,
  isSaving,
  isResetting,
  onTranslate,
  onSave,
  onReset,
  onSelectScheme,
  onUpdate,
}: TranslateListItemRowProps) {
  const catInfo = CATEGORY_STYLES[item.meta.category] || { label: item.meta.label || '文本', badgeClass: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30' }
  const hasSavedVersion = Boolean(item.savedZh && item.savedZh.trim())
  const originalText = item.initialZh ?? item.savedZh ?? ''
  const canReset = Boolean(originalText && (item.zh !== originalText || hasSavedVersion))

  const engineGroups = useMemo(() => {
    const agents = availableEngines.filter((e) => e.group === 'agent')
    const platforms = availableEngines.filter((e) => e.group === 'platform')
    const systems = availableEngines.filter((e) => e.group === 'system')

    return [
      { key: 'agent', items: agents },
      { key: 'platform', items: platforms },
      { key: 'system', items: systems },
    ].filter((g) => g.items.length > 0)
  }, [availableEngines])

  return (
    <div className="flex h-[150px] flex-col min-w-0">
      {/* 1. Header Toolbar: Index, Category Badge, Speaker, Context, Reset (Left) | Translate + Save (Right) */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-4 border-b border-line bg-surface/20 text-xs">
        {/* Left: Metadata info + Reset button */}
        <div className="flex items-center gap-2 overflow-hidden">
          <Tooltip content={`条目序号 #${item.id}`} placement="top">
            <span className="shrink-0 font-mono text-[0.6875rem] text-ink-soft select-none cursor-default">#{item.id}</span>
          </Tooltip>
          {item.meta.localesKey ? (
            <Tooltip content={`本地化 Key: ${item.meta.localesKey}${item.meta.localesFile ? `\n所属语言文件: ${item.meta.localesFile}` : ''}`} placement="top">
              <button
                type="button"
                onClick={() => {
                  if (item.meta.localesKey) {
                    navigator.clipboard?.writeText(item.meta.localesKey)
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.6875rem] font-mono text-accent hover:bg-accent/20 transition-colors cursor-pointer outline-none"
                title="点击复制 Key"
              >
                <LuKey size={11} className="shrink-0" />
                <span className="max-w-[120px] truncate">{item.meta.localesKey}</span>
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={`文案性质：${catInfo.label}`} placement="top">
            <span className={cn('shrink-0 rounded-[0.2rem] border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none cursor-default', catInfo.badgeClass)}>
              {catInfo.label}
            </span>
          </Tooltip>
          {item.meta.file ? (
            <Tooltip content={`来源文件：${item.meta.file}`} placement="top">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] bg-inset px-1.5 py-0.5 text-[0.6875rem] text-ink-soft select-all cursor-default">
                <LuFileText size={11} className="shrink-0 text-accent" />
                <span>{item.meta.file}</span>
              </span>
            </Tooltip>
          ) : null}
          {item.meta.speaker ? (
            <Tooltip content={`说话人：${item.meta.speaker}`} placement="top">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.2rem] bg-inset px-1.5 py-0.5 text-[0.6875rem] text-ink-soft select-all cursor-default">
                <LuUser size={11} className="shrink-0 text-accent" />
                <span>{item.meta.speaker}</span>
              </span>
            </Tooltip>
          ) : null}
          {item.meta.context && item.meta.context !== item.meta.file && item.meta.context !== item.src ? (
            <Tooltip content={`出现场景：${item.meta.context}`} placement="top">
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
            <Tooltip content="恢复为原本的初始译文（不会自动保存，需手动点击保存）" placement="top">
              <span className="inline-flex">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={() => onReset(item)}
                  className="inline-flex h-6 items-center justify-center rounded-[0.2rem] border border-fail/40 bg-fail/10 px-2 text-[0.6875rem] font-medium text-fail hover:bg-fail/20 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isResetting ? <Spinner size="sm" /> : null}
                  重置
                </button>
              </span>
            </Tooltip>
          ) : null}

          {/* Translate Button with Hover Menu */}
          <div className="inline-flex items-center">
            <Tooltip content={isTranslating ? '正在翻译此条目，请稍候…' : `翻译此条目 (当前方案: ${activeSchemeLabel})`} placement="top">
              <span className="inline-flex">
                <button
                  type="button"
                  disabled={isTranslating}
                  onClick={() => onTranslate(item)}
                  className="inline-flex h-6 items-center justify-center rounded-l-[0.2rem] bg-accent px-2 text-[0.6875rem] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isTranslating ? <Spinner size="sm" /> : null}
                  翻译
                </button>
              </span>
            </Tooltip>

            <Menu.Root>
              <Tooltip content={isTranslating ? '正在翻译中，暂无法切换方案' : `选择翻译方案 (当前: ${activeSchemeLabel})`} placement="top">
                <span className="inline-flex">
                  <Menu.Trigger
                    disabled={isTranslating}
                    openOnHover
                    delay={80}
                    closeDelay={150}
                    className="inline-flex h-6 items-center justify-center rounded-r-[0.2rem] bg-accent px-1 text-white hover:bg-accent/90 transition-colors border-l border-black/15 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    aria-label="选择翻译方案"
                  >
                    <LuChevronDown size={11} />
                  </Menu.Trigger>
                </span>
              </Tooltip>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} positionMethod="fixed" className="z-[70]">
                  <Menu.Popup aria-label="选择翻译方案" className={dropdownPopupClass}>
                    <Menu.Item
                      className={cn(dropdownItemClass, 'text-xs py-1.5', selectedScheme === 'all' && 'text-accent font-medium bg-accent/10')}
                      onClick={() => onSelectScheme('all')}
                    >
                      <span>智能翻译</span>
                      {selectedScheme === 'all' ? <LuCheck size={12} className="text-accent" /> : null}
                    </Menu.Item>
                    {engineGroups.map((grp) => (
                      <React.Fragment key={grp.key}>
                        <Menu.Separator className="my-1 h-px bg-line" />
                        {grp.items.map((eng) => (
                          <Menu.Item
                            key={eng.id}
                            className={cn(dropdownItemClass, 'text-xs py-1.5', selectedScheme === eng.id && 'text-accent font-medium bg-accent/10')}
                            onClick={() => onSelectScheme(eng.id)}
                          >
                            <span>{eng.label}</span>
                            {selectedScheme === eng.id ? <LuCheck size={12} className="text-accent" /> : null}
                          </Menu.Item>
                        ))}
                      </React.Fragment>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>

          {/* Save Button */}
          <Tooltip content={isSaving ? '正在保存译文至游戏…' : !item.zh ? '译文为空，请输入或翻译后再保存' : '保存译文至游戏'} placement="top">
            <span className="inline-flex">
              <button
                type="button"
                disabled={isSaving || !item.zh}
                onClick={() => onSave(item)}
                className="inline-flex h-6 items-center justify-center rounded-[0.2rem] bg-ok px-2 text-[0.6875rem] font-medium text-white hover:bg-ok/90 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSaving ? <Spinner size="sm" /> : null}
                保存
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
            aria-label={`条目 #${item.id} 原文`}
          />
        </div>

        {/* Right Column: Translated Editor (Lighter, interactive, bottom border highlights on focus) */}
        <div className="flex flex-col min-w-0 h-full">
          <PlainTextEditor
            value={item.zh}
            disabled={isTranslating}
            softWrap
            fill
            noScrollbars
            className="h-full rounded-none border-0 border-b border-line bg-panel/35 focus-within:border-b-accent focus-within:bg-panel/60 transition-colors [&_.monaco-editor]:!bg-transparent [&_.monaco-editor-background]:!bg-transparent [&_.margin]:!bg-transparent"
            aria-label={`条目 #${item.id} 译文`}
            onChange={(val) => {
              item.zh = val
              onUpdate()
            }}
          />
        </div>
      </div>
    </div>
  )
})
