'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, Modal } from '@/components/sk'
import { formatLanguageLabel } from '@/lib/translate/locales-labels'

export function AppleOfflineGuideModal({ open, fromLang, toLang, onClose }: { open: boolean; fromLang: string; toLang: string; onClose: () => void }) {
  const t = useT()
  return (
    <Modal
      open={open}
      title={t('translate.appleOfflineModalTitle')}
      description={t('translate.appleOfflineModalDesc')}
      onClose={onClose}
      panelClassName="max-w-[34rem]"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="accent" onClick={onClose} data-modal-initial="confirm">
            {t('translate.appleOfflineCloseBtn')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 py-1 text-xs leading-relaxed text-ink">
        <div className="rounded-md border border-accent/20 bg-accent/5 p-3 text-ink">
          <span className="font-semibold text-accent">
            {t('translate.appleOfflineNeededPacks', {
              sourceLang: formatLanguageLabel(fromLang),
              targetLang: formatLanguageLabel(toLang),
            })}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-line bg-panel-soft/60 p-3">
          <div className="flex items-start gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-line text-[10px] font-bold text-ink-soft">1</span>
            <span>{t('translate.appleOfflineStep1')}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-line text-[10px] font-bold text-ink-soft">2</span>
            <span>{t('translate.appleOfflineStep2')}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-line text-[10px] font-bold text-ink-soft">3</span>
            <span>{t('translate.appleOfflineStep3')}</span>
          </div>
        </div>

        <div className="text-[11px] text-ink-soft">{t('translate.appleOfflineVersionNote')}</div>
      </div>
    </Modal>
  )
}
