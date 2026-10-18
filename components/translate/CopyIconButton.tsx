'use client'

import { type MouseEvent, useEffect, useState } from 'react'
import { IoCheckmark, IoCopyOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk/Button'
import { cn } from '@/lib/utils'

function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined') return false
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

function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyWithSelection(text)
    )
  }
  return Promise.resolve(copyWithSelection(text))
}

export function CopyIconButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const ok = await copyText(text)
    if (ok) setCopied(true)
  }

  const tip = copied ? t('common.copied') : label || t('common.copy')

  return (
    <Button
      type="button"
      variant="plain"
      size="mini"
      aria-label={tip}
      tooltip={tip}
      disabled={!text}
      onClick={handleCopy}
      className={cn(
        'size-5 min-h-5 min-w-5 rounded p-0 text-ink-soft opacity-35 transition-opacity hover:text-ink hover:opacity-100 group-hover/cell:opacity-100 focus-visible:opacity-100',
        copied && 'text-ok opacity-100 hover:text-ok',
        className
      )}
    >
      {copied ? <IoCheckmark size={12} aria-hidden /> : <IoCopyOutline size={12} aria-hidden />}
    </Button>
  )
}
