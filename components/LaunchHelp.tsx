'use client'

import { useState } from 'react'
import { IoHelpCircleOutline } from 'react-icons/io5'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, CopyField, Modal } from '@/components/sk'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import { remoteScriptCommand, remoteScriptUrl } from '@/lib/remote-scripts/command'

const MAC_SHELL_SCRIPT_NAME = 'mac-shell.sh'
const MAC_STEPS = ['launchHelp.macStep1', 'launchHelp.macStep2', 'launchHelp.macStep3', 'launchHelp.macStep4'] as const

/** Installation and recovery run natively: the browser cannot write the bundle's framework symlinks. */
export function MacShellDialog({ open, onClose, gameName }: { open: boolean; onClose: () => void; gameName?: string }) {
  const t = useT()
  const origin = usePageOrigin()
  const locale = useLocaleCode()
  const command = origin ? remoteScriptCommand(origin, MAC_SHELL_SCRIPT_NAME, locale) : ''
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('launchHelp.macTitle')}
      description={t('launchHelp.macDescription')}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col gap-3 text-left text-sm leading-relaxed text-ink-soft">
        {gameName ? <p className="m-0 break-all">{t('launchHelp.pickSameDir', { name: gameName })}</p> : null}
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {MAC_STEPS.map((key, index) => (
            <li key={key} className="flex gap-3">
              <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[0.7rem] font-semibold text-ink">
                {index + 1}
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-xs">{t('launchHelp.macNote')}</p>
        <div className="flex flex-col gap-2">
          <CopyField value={command} label={t('launchHelp.commandAria')} />
          {origin ? (
            <a
              href={remoteScriptUrl(origin, MAC_SHELL_SCRIPT_NAME)}
              target="_blank"
              rel="noreferrer"
              className="self-start text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              {t('launchHelp.viewCommand')}
            </a>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

export function LaunchHelp() {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        className="!h-auto !min-h-0 justify-start !border-0 !bg-transparent !px-0 !py-0 !text-xs !font-normal text-ink-soft !shadow-none hover:enabled:text-ink focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-accent"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <IoHelpCircleOutline size={14} aria-hidden />
        {t('launchHelp.macFixLink')}
      </Button>
      <MacShellDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
