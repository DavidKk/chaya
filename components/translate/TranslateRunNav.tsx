'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { SegmentedNav } from '@/components/sk'
import { TRANSLATE_RUN_MODES, type TranslateRunMode } from '@/components/translate/tabs'

/** 右侧内容的模式 Tab；注入到页头右侧（PanelHeadEnd）。 */
export function TranslateRunNav({ value, onChange, panelId }: { value: TranslateRunMode; onChange: (mode: TranslateRunMode) => void; panelId: string }) {
  const t = useT()
  const content = (
    <div data-translate-run-nav className="inline-flex items-center">
      <SegmentedNav
        value={value}
        onChange={onChange}
        aria-label={t('translate.configAria')}
        items={TRANSLATE_RUN_MODES.map((mode) => ({
          id: mode,
          label: t(mode === 'seed' ? 'translate.seedTab' : mode === 'list' ? 'translate.listTab' : 'translate.playTab'),
          panelId: `${panelId}-${mode}`,
        }))}
      />
    </div>
  )
  return <PanelHeadEnd fallback={content}>{content}</PanelHeadEnd>
}
