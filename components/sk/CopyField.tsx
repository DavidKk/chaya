'use client'

import { useEffect, useState } from 'react'
import { LuCheck, LuCopy, LuX } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk/Button'
import { cn } from '@/lib/utils'

export type CopyFieldProps = {
  value: string
  /** Accessible name of the text block, e.g. "macOS install command" */
  label?: string
  className?: string
}

type CopyState = 'idle' | 'ok' | 'fail'

const RESET_MS = 2000

/** `navigator.clipboard` is missing on plain-http LAN origins and may be denied; fall back to a selection copy. */
function copyWithSelection(text: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previous?.focus()
  }
}

/** Read-only command / link with an inline copy button; the one copy UI for commands and links. */
export function CopyField({ value, label, className }: CopyFieldProps) {
  const t = useT()
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), RESET_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('ok')
    } catch {
      setState(copyWithSelection(value) ? 'ok' : 'fail')
    }
  }

  const Icon = state === 'ok' ? LuCheck : state === 'fail' ? LuX : LuCopy
  const tip = state === 'ok' ? t('common.copied') : state === 'fail' ? t('common.copyFailed') : t('common.copy')

  return (
    <div className={cn('relative rounded-[0.25rem] border border-line bg-panel-2', className)}>
      <code
        tabIndex={0}
        aria-label={label}
        className="block min-h-10 whitespace-pre-wrap break-all py-2.5 pr-12 pl-3 font-mono text-xs leading-relaxed text-ink select-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {value}
      </code>
      <Button
        size="icon"
        variant="ghost"
        aria-label={tip}
        disabled={!value}
        onClick={() => void copy()}
        className={cn('absolute top-1 right-1', state === 'ok' && 'text-ok', state === 'fail' && 'text-fail')}
      >
        <Icon aria-hidden className="size-4" />
      </Button>
      <span role="status" className="sr-only">
        {state === 'idle' ? '' : tip}
      </span>
    </div>
  )
}
