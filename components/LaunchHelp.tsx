'use client'

import { useState } from 'react'
import { IoHelpCircleOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, Modal } from '@/components/sk'
import { MAC_SHELL_COMMAND } from '@/lib/game/mac-shell-command'

/** Both installation and recovery use native extraction, never browser ZIP writes. */
export function MacShellDialog({ open, onClose, gameName }: { open: boolean; onClose: () => void; gameName?: string }) {
  const t = useT()
  const [copyStatus, setCopyStatus] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(MAC_SHELL_COMMAND)
      setCopyStatus(t('launchHelp.copied'))
    } catch {
      setCopyStatus(t('launchHelp.copyFailed'))
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('launchHelp.macTitle')}
      description={t('launchHelp.macDescription')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="accent" onClick={() => void copy()}>
            {t('launchHelp.copyCommand')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-left text-sm leading-relaxed text-ink-soft">
        {gameName ? <p className="m-0 break-all">{t('launchHelp.pickSameDir', { name: gameName })}</p> : null}
        <p className="m-0">{t('launchHelp.macBody1')}</p>
        <p className="m-0">{t('launchHelp.macBody2')}</p>
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-ink">{t('launchHelp.viewCommand')}</summary>
          <pre
            tabIndex={0}
            aria-label={t('launchHelp.commandAria')}
            className="m-0 whitespace-pre-wrap break-all rounded-md border border-line bg-panel-2 p-3 text-xs text-ink select-text"
          >
            {MAC_SHELL_COMMAND}
          </pre>
        </details>
        <p role="status" className="m-0 text-xs">
          {copyStatus}
        </p>
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
