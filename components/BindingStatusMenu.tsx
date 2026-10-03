'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoAlertCircle, IoCheckmark, IoCheckmarkCircle } from 'react-icons/io5'
import { RiAlarmWarningLine } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { useFloatingPanel } from '@/components/sk/useFloatingPanel'
import { SHELL_APP_NAME, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { DATA_DIR_NAME, SHELL_DIR_NAME } from '@/constants/path-names'
import type { MessageKey, MessageParams } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type BindingStatusPlugin = {
  name: string
  registered: boolean
  enabled: boolean
  fileExists: boolean
}

export type BindingStatusInput = {
  kind: string
  hasShell: boolean
  bundled: boolean
  plugins: BindingStatusPlugin[]
  hasNwPackage: boolean
  platform?: string
  /** 壳所在 / 应装到的位置；缺省为工具 data/shell（浏览器模式壳在游戏目录内） */
  shellPath?: string
}

export type BindingCheckItem = {
  id: string
  ok: boolean
  /** 满足时的短文案 */
  label: string
  /** 未满足时展示的问题说明 */
  problem: string
}

type TranslateFn = (key: MessageKey, params?: MessageParams) => string

export function buildBindingChecks(status: BindingStatusInput, t: TranslateFn): BindingCheckItem[] {
  const layoutLabel = status.bundled || status.kind === 'app.nw' ? t('binding.contentBundled') : status.kind === 'www' ? t('binding.contentWww') : t('binding.contentRoot')

  const shellOk = status.hasShell
  const winHost = status.platform === 'win32'
  const shellDirHint = `${DATA_DIR_NAME}/${SHELL_DIR_NAME}`
  const shellLabel = status.bundled
    ? winHost
      ? t('binding.shellExe')
      : t('binding.shellApp')
    : t('binding.shellReadyAt', { path: status.shellPath ?? (winHost ? `${shellDirHint}/${SHELL_WIN_DIR_NAME}` : `${shellDirHint}/${SHELL_APP_NAME}`) })
  const shellProblem = winHost
    ? t('binding.shellMissingWin', { path: status.shellPath ?? `${shellDirHint}/${SHELL_WIN_DIR_NAME}` })
    : t('binding.shellMissingMac', { path: status.shellPath ?? `${shellDirHint}/` })

  const missingPlugins = status.plugins.filter((p) => !p.fileExists).map((p) => p.name)
  const unregistered = status.plugins.filter((p) => p.fileExists && !p.registered).map((p) => p.name)
  const pluginsOk = missingPlugins.length === 0 && unregistered.length === 0
  let pluginsProblem = t('binding.pluginsBad')
  if (missingPlugins.length && unregistered.length) {
    pluginsProblem = t('binding.pluginsBoth', { missing: missingPlugins.join('、'), unregistered: unregistered.join('、') })
  } else if (missingPlugins.length) {
    pluginsProblem = t('binding.pluginsMissingFiles', { names: missingPlugins.join('、') })
  } else if (unregistered.length) {
    pluginsProblem = t('binding.pluginsUnregistered', { names: unregistered.join('、') })
  }

  return [
    { id: 'content', ok: true, label: layoutLabel, problem: t('binding.contentMissing') },
    { id: 'shell', ok: shellOk, label: shellLabel, problem: shellProblem },
    {
      id: 'window',
      ok: status.hasNwPackage,
      label: t('binding.windowOk'),
      problem: t('binding.windowMissing'),
    },
    {
      id: 'plugins',
      ok: pluginsOk,
      label: t('binding.pluginsOk'),
      problem: pluginsProblem,
    },
  ]
}

export function BindingStatusMenu({ status }: { status: BindingStatusInput }) {
  const t = useT()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const items = useMemo(() => buildBindingChecks(status, t), [status, t])
  const allOk = items.every((item) => item.ok)
  const panelStyle = useFloatingPanel({
    open,
    anchorRef: rootRef,
    panelRef,
    maxHeight: 280,
    widthMode: 'content',
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <Tooltip content={allOk ? t('binding.ok') : t('binding.bad')} placement="top">
        <button
          type="button"
          className={cn(
            'inline-flex h-[1.35rem] w-[1.35rem] cursor-pointer appearance-none items-center justify-center rounded-[0.15rem] border-none bg-transparent p-0 transition-[color,opacity] duration-150',
            'hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]',
            allOk ? 'text-ok' : 'text-warn'
          )}
          aria-label={allOk ? t('binding.ok') : t('binding.bad')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {allOk ? <IoCheckmarkCircle size={16} aria-hidden /> : <RiAlarmWarningLine size={16} aria-hidden />}
        </button>
      </Tooltip>

      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              id={listId}
              className={cn(
                'z-[70] min-w-[14rem] max-w-[min(22rem,calc(100vw-1.5rem))] rounded-[0.35rem] border border-line bg-panel px-3 pt-2 pb-2',
                'shadow-[0_10px_28px_rgb(0_0_0_/_0.4),inset_0_1px_0_rgb(255_255_255_/_0.04)]'
              )}
              role="listbox"
              aria-label={t('binding.checkAria')}
              style={panelStyle}
            >
              <p className="m-0 mb-2 px-1 text-[0.7rem] font-medium text-ink-soft">{t('binding.title')}</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={cn('flex items-start gap-2 px-1 py-0.5 text-[0.78rem] leading-[1.35]', item.ok ? 'text-ink-soft' : 'text-ink')}
                    role="option"
                    aria-selected={item.ok}
                  >
                    <span className={cn('mt-0.5 inline-flex shrink-0', item.ok ? 'text-ok' : 'text-warn')} aria-hidden>
                      {item.ok ? <IoCheckmark size={14} /> : <IoAlertCircle size={14} />}
                    </span>
                    <span className="min-w-0">{item.ok ? item.label : item.problem}</span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
