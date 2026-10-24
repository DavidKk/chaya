'use client'

import { IoArrowUndoOutline, IoLanguageOutline, IoLinkOutline, IoSaveOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'

export function TranslateListPageActions(props: {
  resettingPage: boolean
  translatingPage: boolean
  savingPage: boolean
  syncingNames: boolean
  emptyPage: boolean
  schemeLabel: string
  onReset: () => void
  onTranslate: () => void
  onSyncNames: () => void
  onSave: () => void
  syncDisabled?: boolean
}) {
  const t = useT()
  const busy = props.translatingPage || props.savingPage || props.resettingPage || props.syncingNames
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        loading={props.resettingPage}
        disabled={busy || props.emptyPage}
        aria-label={t('translate.listResetPageBtn')}
        tooltip={t('translate.listResetPageTooltip')}
        onClick={props.onReset}
      >
        <IoArrowUndoOutline size={15} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        loading={props.translatingPage}
        disabled={busy || props.emptyPage}
        aria-label={t('translate.listTranslatePageBtn')}
        tooltip={props.translatingPage ? t('translate.listTranslatePageRunning') : t('translate.listTranslatePageTooltip', { scheme: props.schemeLabel })}
        onClick={props.onTranslate}
      >
        <IoLanguageOutline size={15} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        loading={props.syncingNames}
        disabled={busy || !!props.syncDisabled}
        aria-label={t('translate.syncNames')}
        tooltip={props.syncingNames ? t('translate.syncNamesRunning') : t('translate.syncNamesTooltip')}
        onClick={props.onSyncNames}
      >
        <IoLinkOutline size={15} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        loading={props.savingPage}
        disabled={busy || props.emptyPage}
        aria-label={t('translate.listSavePageBtn')}
        tooltip={t('translate.listSavePageTooltip')}
        onClick={props.onSave}
      >
        <IoSaveOutline size={15} aria-hidden />
      </Button>
    </>
  )
}
