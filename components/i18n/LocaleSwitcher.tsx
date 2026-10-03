'use client'

import { Menu } from '@base-ui/react/menu'
import { useEffect, useRef, useState } from 'react'
import { IoCheckmark, IoGlobeOutline } from 'react-icons/io5'

import { useLocale } from '@/components/i18n/LocaleProvider'
import { dropdownItemClass, dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { detectBrowserLocale, isLocalePreference, LOCALE_NATIVE_LABEL, LOCALES } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** 营销页等窄位：更紧凑 */
  compact?: boolean
}

/** 界面语言切换：首项跟随系统，其余用母语标签（不随 locale 翻译） */
export function LocaleSwitcher({ className }: Props) {
  const { locale, preference, ready, setLocale, t } = useLocale()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [])

  const options = [
    { value: 'auto', label: t('locale.auto', { name: LOCALE_NATIVE_LABEL[preference === 'auto' ? locale : detectBrowserLocale()] }) },
    ...LOCALES.map((value) => ({ value, label: LOCALE_NATIVE_LABEL[value] })),
  ]

  return (
    <span ref={anchorRef} className={cn('inline-flex', !ready && 'invisible', className)}>
      <Menu.Root>
        <Menu.Trigger aria-label={t('locale.switch')} className={dropdownTriggerClass}>
          <IoGlobeOutline size={15} aria-hidden className="shrink-0" />
          <span className="whitespace-nowrap">{LOCALE_NATIVE_LABEL[locale]}</span>
        </Menu.Trigger>
        <Menu.Portal container={container}>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Menu.Popup aria-label={t('locale.switch')} className={dropdownPopupClass}>
              <Menu.RadioGroup
                value={preference}
                onValueChange={(value: unknown) => {
                  if (isLocalePreference(value)) setLocale(value)
                }}
              >
                {options.map((opt, index) => (
                  <div key={opt.value}>
                    {index === 1 ? <Menu.Separator className="mx-2 my-1 h-px bg-[rgb(230_238_248/0.08)]" /> : null}
                    <Menu.RadioItem value={opt.value} closeOnClick className={dropdownItemClass}>
                      {opt.label}
                      <Menu.RadioItemIndicator keepMounted className="inline-flex shrink-0 data-[unchecked]:invisible">
                        <IoCheckmark size={14} aria-hidden />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  </div>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  )
}
