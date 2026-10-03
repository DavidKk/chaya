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

  const copyButton = (
    <Button
      size="icon"
      variant="ghost"
      aria-label={tip}
      disabled={!value}
      onClick={() => void copy()}
      className={cn(value.includes('\n') ? 'absolute top-1 right-1' : 'h-full rounded-none border-0', state === 'ok' && 'text-ok', state === 'fail' && 'text-fail')}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  )
  const status = (
    <span role="status" className="sr-only">
      {state === 'idle' ? '' : tip}
    </span>
  )

  if (value.includes('\n')) {
    return (
      <div role={label ? 'group' : undefined} aria-label={label} className={cn('relative rounded-[0.25rem] border border-line bg-panel-2', className)}>
        <code
          tabIndex={0}
          className="block overflow-x-auto whitespace-pre py-2 pr-12 pl-3 font-mono text-xs leading-relaxed text-ink select-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {value}
        </code>
        {copyButton}
        {status}
      </div>
    )
  }

  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cn(
        'flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-[0.25rem] border border-line bg-panel-2 transition-[border-color] duration-100 focus-within:border-accent',
        className
      )}
    >
      <input
        type="text"
        readOnly
        value={value}
        aria-label={label}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
        className="m-0 min-w-0 flex-1 appearance-none border-none bg-transparent px-3 font-mono text-xs text-ink outline-none"
      />
      <span aria-hidden className="my-2 w-px shrink-0 bg-line" />
      {copyButton}
      {status}
    </div>
  )
}
