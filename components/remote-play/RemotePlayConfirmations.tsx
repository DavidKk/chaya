'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, GradientButton } from '@/components/sk'
import { Modal } from '@/components/sk/Modal'

import { remoteModalSafeArea } from './GameSelectorModal'

export function RemotePlayConfirmations({
  reloadOpen,
  quitOpen,
  onCloseReload,
  onCloseQuit,
  onReload,
  onQuit,
}: {
  reloadOpen: boolean
  quitOpen: boolean
  onCloseReload: () => void
  onCloseQuit: () => void
  onReload: () => void
  onQuit: () => void
}) {
  const t = useT()
  return (
    <>
      <Modal open={reloadOpen} title={t('play.reloadConfirmTitle')} onClose={onCloseReload} className={remoteModalSafeArea}>
        <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('play.reloadConfirmDesc')}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onCloseReload}>{t('common.cancel')}</Button>
          <GradientButton size="md" variant="ok" onClick={onReload}>
            {t('common.confirm')}
          </GradientButton>
        </div>
      </Modal>
      <Modal open={quitOpen} title={t('play.quitGameConfirmTitle')} onClose={onCloseQuit} className={remoteModalSafeArea}>
        <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('play.quitGameConfirmDesc')}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onCloseQuit}>{t('common.cancel')}</Button>
          <GradientButton size="md" variant="fail" onClick={onQuit}>
            {t('play.quitGame')}
          </GradientButton>
        </div>
      </Modal>
    </>
  )
}
