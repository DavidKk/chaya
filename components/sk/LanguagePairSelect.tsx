'use client'

import { Menu } from '@base-ui/react/menu'
import React, { useCallback, useMemo, useState } from 'react'
import { LiaExchangeAltSolid } from 'react-icons/lia'
import { LuCheck, LuChevronDown, LuPlus } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'
import { Tooltip } from '@/components/sk/Tooltip'
import { CORE_TRANSLATION_LANGUAGES, formatLanguageLabel } from '@/lib/translate/locales-labels'
import { cn } from '@/lib/utils'

export type LanguagePairSelectProps = {
  sourceLang: string
  targetLang: string
  availableLanguages: string[]
  onSourceChange: (lang: string) => void
  onTargetChange: (lang: string) => void
  className?: string
  disabled?: boolean
}

const COMMON_TARGET_LANGS = CORE_TRANSLATION_LANGUAGES.map((l) => l.code)

export function LanguagePairSelect({ sourceLang, targetLang, availableLanguages, onSourceChange, onTargetChange, className, disabled = false }: LanguagePairSelectProps) {
  const t = useT()
  const [customLangOpen, setCustomLangOpen] = useState(false)
  const [customLangInput, setCustomLangInput] = useState('')

  const sourceOptions = useMemo(() => {
    return availableLanguages.map((code) => ({
      code,
      label: formatLanguageLabel(code),
    }))
  }, [availableLanguages])

  const targetOptions = useMemo(() => {
    const list = [...availableLanguages]
    for (const common of COMMON_TARGET_LANGS) {
      if (!list.includes(common)) list.push(common)
    }
    if (targetLang && !list.includes(targetLang)) {
      list.push(targetLang)
    }
    return list.map((code) => ({
      code,
      label: formatLanguageLabel(code),
      isExisting: availableLanguages.includes(code),
    }))
  }, [availableLanguages, targetLang])

  const handleSwap = useCallback(() => {
    if (disabled || !targetLang) return
    const prevSource = sourceLang
    const prevTarget = targetLang
    onSourceChange(prevTarget)
    onTargetChange(prevSource)
  }, [disabled, sourceLang, targetLang, onSourceChange, onTargetChange])

  const handleAddCustomLang = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = customLangInput.trim().toLowerCase()
      if (trimmed) {
        onTargetChange(trimmed)
        setCustomLangInput('')
        setCustomLangOpen(false)
      }
    },
    [customLangInput, onTargetChange]
  )

  const sourceLabel = formatLanguageLabel(sourceLang) || sourceLang || t('translate.langSelectChooseSource')
  const targetLabel = formatLanguageLabel(targetLang) || targetLang || t('translate.langSelectChooseTarget')

  return (
    <div
      className={cn(
        'inline-flex h-8 items-center rounded-[0.25rem] border border-line bg-surface-subtle/80 px-2 text-xs text-ink transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-line-focus focus-within:border-accent',
        className
      )}
    >
      {/* 1. Left: Source Language Dropdown */}
      <Menu.Root>
        <Tooltip content={t('translate.langSelectSourceTooltip')} placement="top">
          <span className="inline-flex">
            <Menu.Trigger
              disabled={disabled}
              className="inline-flex h-6 items-center gap-1 px-1.5 font-medium text-ink hover:text-accent transition-colors cursor-pointer rounded outline-none select-none"
              aria-label={t('translate.langSelectSourceAria')}
            >
              <span className="max-w-[120px] truncate">{sourceLabel}</span>
              <LuChevronDown size={11} className="text-ink-soft shrink-0" />
            </Menu.Trigger>
          </span>
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-[75]">
            <Menu.Popup aria-label={t('translate.langSelectSourceAria')} className={dropdownPopupClass}>
              <div className="px-2 py-1 text-[0.6875rem] font-semibold text-ink-soft select-none">{t('translate.langSelectSourceHeader')}</div>
              {sourceOptions.map((opt) => (
                <Menu.Item
                  key={opt.code}
                  className={cn(dropdownItemClass, 'text-xs py-1.5', sourceLang === opt.code && 'text-accent font-medium bg-accent/10')}
                  onClick={() => onSourceChange(opt.code)}
                >
                  <span>{opt.label}</span>
                  {sourceLang === opt.code ? <LuCheck size={12} className="text-accent" /> : null}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {/* 2. Middle: Exchange Icon */}
      <Tooltip content={t('translate.langSelectSwapTooltip')} placement="top">
        <button
          type="button"
          disabled={disabled}
          onClick={handleSwap}
          className="mx-1 inline-flex h-5 w-5 items-center justify-center rounded text-ink-soft hover:text-accent hover:bg-white/5 transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
          aria-label={t('translate.langSelectSwapAria')}
        >
          <LiaExchangeAltSolid size={14} />
        </button>
      </Tooltip>

      {/* 3. Right: Target Language Dropdown */}
      <Menu.Root>
        <Tooltip content={t('translate.langSelectTargetTooltip')} placement="top">
          <span className="inline-flex">
            <Menu.Trigger
              disabled={disabled}
              className="inline-flex h-6 items-center gap-1 px-1.5 font-medium text-ink hover:text-accent transition-colors cursor-pointer rounded outline-none select-none"
              aria-label={t('translate.langSelectTargetAria')}
            >
              <span className="max-w-[120px] truncate">{targetLabel}</span>
              <LuChevronDown size={11} className="text-ink-soft shrink-0" />
            </Menu.Trigger>
          </span>
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-[75]">
            <Menu.Popup aria-label={t('translate.langSelectTargetAria')} className={dropdownPopupClass}>
              <div className="px-2 py-1 text-[0.6875rem] font-semibold text-ink-soft select-none">{t('translate.langSelectTargetHeader')}</div>
              {targetOptions
                .filter((opt) => opt.isExisting)
                .map((opt) => (
                  <Menu.Item
                    key={opt.code}
                    className={cn(dropdownItemClass, 'text-xs py-1.5', targetLang === opt.code && 'text-accent font-medium bg-accent/10')}
                    onClick={() => onTargetChange(opt.code)}
                  >
                    <span>{opt.label}</span>
                    {targetLang === opt.code ? <LuCheck size={12} className="text-accent" /> : null}
                  </Menu.Item>
                ))}

              <Menu.Separator className="my-1 h-px bg-line" />
              <div className="px-2 py-1 text-[0.6875rem] font-semibold text-ink-soft select-none">{t('translate.langSelectExtendedHeader')}</div>
              {targetOptions
                .filter((opt) => !opt.isExisting)
                .map((opt) => (
                  <Menu.Item
                    key={opt.code}
                    className={cn(dropdownItemClass, 'text-xs py-1.5', targetLang === opt.code && 'text-accent font-medium bg-accent/10')}
                    onClick={() => onTargetChange(opt.code)}
                  >
                    <span>{opt.label}</span>
                    {targetLang === opt.code ? <LuCheck size={12} className="text-accent" /> : null}
                  </Menu.Item>
                ))}

              <Menu.Separator className="my-1 h-px bg-line" />
              {customLangOpen ? (
                <form onSubmit={handleAddCustomLang} className="p-1.5 flex items-center gap-1">
                  <input
                    type="text"
                    value={customLangInput}
                    onChange={(e) => setCustomLangInput(e.target.value)}
                    placeholder={t('translate.langSelectCustomPlaceholder')}
                    className="h-6 w-28 rounded border border-line bg-surface px-1.5 text-xs text-ink outline-none focus:border-accent"
                    autoFocus
                  />
                  <button type="submit" className="h-6 rounded bg-accent px-2 text-[0.6875rem] text-white hover:bg-accent/90">
                    {t('translate.langSelectCustomConfirm')}
                  </button>
                </form>
              ) : (
                <Menu.Item className={cn(dropdownItemClass, 'text-xs py-1.5 text-ink-soft hover:text-ink')} onClick={() => setCustomLangOpen(true)}>
                  <span className="flex items-center gap-1.5">
                    <LuPlus size={12} />
                    <span>{t('translate.langSelectAddCustom')}</span>
                  </span>
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
