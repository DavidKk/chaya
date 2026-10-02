'use client'

import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IoCloseOutline } from 'react-icons/io5'

import { ScrollArea } from '@/components/sk/ScrollArea'
import { cn } from '@/lib/utils'

export type ModalProps = {
  open: boolean
  title: string
  /** 可选描述；有则挂 `aria-describedby` */
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  /**
   * 异步确认进行中：禁止 Escape / 遮罩 / 关闭钮；
   * 与 ConfirmDialog 的 confirming 对齐。
   */
  busy?: boolean
  /** 默认 document.body；局内 Shadow 传带 token 的宿主 */
  portalContainer?: Element | null
  /** 隐藏标题栏关闭钮（Confirm 常用 footer 取消） */
  hideCloseButton?: boolean
  className?: string
  panelClassName?: string
  /** Only the user may settle it: WebMCP page tools refuse to click inside or press Enter */
  userConfirmOnly?: boolean
}

function isImeComposing(e: KeyboardEvent) {
  return e.isComposing || e.keyCode === 229
}

function focusables(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  return [...nodes].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')
}

/**
 * 阻塞式模态框：portal + dialog 语义 + Escape/遮罩关闭 + 焦点陷阱与还原 + body 锁滚。
 * ConfirmDialog 等组合此组件，勿再复制一套壳。
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  busy = false,
  portalContainer,
  hideCloseButton = false,
  className,
  panelClassName,
  userConfirmOnly = false,
}: ModalProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const preferred = panel.querySelector<HTMLElement>('textarea:not([disabled]), input:not([disabled])')
      const list = focusables(panel)
      const target = preferred ?? list.find((el) => el.getAttribute('data-modal-initial') === 'confirm') ?? list[0]
      target?.focus()
    })

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isImeComposing(e) || busy) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const list = focusables(panelRef.current)
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      const prev = restoreFocusRef.current
      if (prev && document.contains(prev)) prev.focus()
      restoreFocusRef.current = null
    }
  }, [busy, onClose, open])

  if (!open || typeof document === 'undefined') return null

  const mount = portalContainer ?? document.body
  const hasDesc = description != null && description !== false && description !== ''

  return createPortal(
    <div className={cn('fixed inset-0 z-[80] flex items-center justify-center p-4', className)} role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-none bg-[rgb(0_0_0/0.45)] p-0"
        aria-label="关闭对话框"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        data-webmcp-confirm={userConfirmOnly ? '' : undefined}
        aria-labelledby={titleId}
        aria-describedby={hasDesc ? descId : undefined}
        className={cn(
          'relative z-[1] flex w-full max-w-[28rem] flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel',
          'shadow-[0_16px_40px_rgb(0_0_0/0.45)]',
          'max-h-[min(32rem,calc(100dvh-2rem))]',
          panelClassName
        )}
      >
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
          <h2 id={titleId} className="m-0 truncate text-[0.8125rem] font-semibold text-ink">
            {title}
          </h2>
          {!hideCloseButton ? (
            <button
              type="button"
              disabled={busy}
              aria-label="关闭"
              className={cn(
                'm-0 inline-flex size-7 shrink-0 cursor-pointer appearance-none items-center justify-center border-none bg-transparent p-0 text-ink-soft outline-none',
                'hover:enabled:text-ink focus:outline-none focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-45'
              )}
              onClick={onClose}
            >
              <IoCloseOutline size={18} aria-hidden />
            </button>
          ) : null}
        </div>
        {hasDesc || children ? (
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': title }}>
            <div className="flex flex-col gap-[0.65rem] px-4 py-3">
              {hasDesc ? (
                <div id={descId} className="text-[0.8125rem] leading-snug text-ink">
                  {description}
                </div>
              ) : null}
              {children}
            </div>
          </ScrollArea>
        ) : null}
        {footer ? <div className="flex shrink-0 items-center justify-end gap-[0.4rem] border-t border-line px-4 py-[0.55rem]">{footer}</div> : null}
      </div>
    </div>,
    mount
  )
}
