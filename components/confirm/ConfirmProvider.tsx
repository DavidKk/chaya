'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, type ButtonVariant } from '@/components/sk/Button'
import { Modal } from '@/components/sk/Modal'

export type ConfirmVariant = Extract<ButtonVariant, 'fail' | 'accent' | 'ok' | 'warn' | 'default'>

export type ConfirmRequest = {
  title: string
  description?: ReactNode
  /** 确认钮文案，默认「确认」 */
  confirmLabel?: string
  /** 取消钮文案，默认「取消」 */
  cancelLabel?: string
  /** 危险操作用 `fail` */
  confirmVariant?: ConfirmVariant
  /**
   * 点确认后执行；返回 Promise 时对话框保持打开并进入 confirming。
   * 抛错则保持打开（不 settle），由调用方自行 toast。
   */
  onConfirm?: () => void | Promise<void>
}

type Session = {
  id: number
  request: ConfirmRequest
  resolve: (ok: boolean) => void
}

type ConfirmContextValue = {
  confirm: (request: ConfirmRequest) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

/**
 * 全局 Promise `confirm()`：基于 Modal，替换 `window.confirm`。
 * 新会话会先把上一次 settle 为 false。
 */
export function ConfirmProvider({
  children,
  portalContainer,
}: {
  children: ReactNode
  /** 局内 Shadow 等：挂到带 token 的容器 */
  portalContainer?: Element | null
}) {
  const t = useT()
  const [session, setSession] = useState<Session | null>(null)
  const [confirming, setConfirming] = useState(false)
  const seqRef = useRef(0)
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const settle = useCallback((ok: boolean) => {
    const cur = sessionRef.current
    if (!cur) return
    sessionRef.current = null
    setSession(null)
    setConfirming(false)
    cur.resolve(ok)
  }, [])

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      const prev = sessionRef.current
      if (prev) {
        sessionRef.current = null
        setConfirming(false)
        prev.resolve(false)
      }
      const id = ++seqRef.current
      const next: Session = { id, request, resolve }
      sessionRef.current = next
      setSession(next)
    })
  }, [])

  useEffect(
    () => () => {
      const cur = sessionRef.current
      if (cur) {
        sessionRef.current = null
        cur.resolve(false)
      }
    },
    []
  )

  const runConfirm = useCallback(async () => {
    const cur = sessionRef.current
    if (!cur || confirming) return
    const { onConfirm } = cur.request
    if (!onConfirm) {
      settle(true)
      return
    }
    setConfirming(true)
    try {
      await onConfirm()
      settle(true)
    } catch {
      setConfirming(false)
    }
  }, [confirming, settle])

  useEffect(() => {
    if (!session || confirming) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (e.isComposing || e.keyCode === 229) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      e.stopPropagation()
      void runConfirm()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirming, runConfirm, session])

  const value = useMemo(() => ({ confirm }), [confirm])

  const req = session?.request
  const confirmVariant: ConfirmVariant = req?.confirmVariant ?? 'accent'

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {req ? (
        <Modal
          open
          title={req.title}
          description={req.description}
          busy={confirming}
          hideCloseButton
          portalContainer={portalContainer}
          onClose={() => {
            if (!confirming) settle(false)
          }}
          footer={
            <>
              <Button variant="ghost" disabled={confirming} onClick={() => settle(false)}>
                {req.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button variant={confirmVariant} loading={confirming} disabled={confirming} data-modal-initial="confirm" onClick={() => void runConfirm()}>
                {req.confirmLabel ?? t('common.confirm')}
              </Button>
            </>
          }
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used within ConfirmProvider')
  }
  return ctx.confirm
}
