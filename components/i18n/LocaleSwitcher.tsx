'use client'

import { useLocale } from '@/components/i18n/LocaleProvider'
import { Select } from '@/components/sk'
import { type Locale, LOCALE_NATIVE_LABEL, LOCALES } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const OPTIONS = LOCALES.map((value) => ({ value, label: LOCALE_NATIVE_LABEL[value] }))

type Props = {
  className?: string
  /** 营销页等窄位：更紧凑 */
  compact?: boolean
}

/** 右上角界面语言切换（母语标签，不随 locale 翻译） */
export function LocaleSwitcher({ className, compact = false }: Props) {
  const { locale, ready, setLocale, t } = useLocale()

  return (
    <Select
      value={locale}
      options={OPTIONS}
      onChange={(value) => setLocale(value as Locale)}
      aria-label={t('locale.switch')}
      panelWidth="content"
      className={cn(compact ? 'min-w-[6.5rem]' : 'min-w-[7.25rem]', !ready && 'invisible', className)}
    />
  )
}
