'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { SegmentedNav } from '@/components/sk'
import { TRANSLATE_RUN_MODES, type TranslateRunMode } from '@/components/translate/tabs'

/** 右侧内容的模式 Tab；与左侧共用引擎选择并列，切换不重挂引擎面板。 */
export function TranslateRunNav({ value, onChange, panelId }: { value: TranslateRunMode; onChange: (mode: TranslateRunMode) => void; panelId: string }) {
  const t = useT()
  return (
    <div data-translate-run-nav className="flex min-h-[3.25rem] shrink-0 items-center border-b border-line px-4 py-2">
      <SegmentedNav
        value={value}
        onChange={onChange}
        aria-label={t('translate.configAria')}
        items={TRANSLATE_RUN_MODES.map((mode) => ({ id: mode, label: t(mode === 'seed' ? 'translate.seedTab' : 'translate.playTab'), panelId: `${panelId}-${mode}` }))}
      />
    </div>
  )
}
