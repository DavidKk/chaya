'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { IoCopyOutline } from 'react-icons/io5'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
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
  /** 强制输入验证短语（如 DELETE my-project），必须完全匹配才允许确认 */
  challengePhrase?: string
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
  const locale = useLocaleCode()
  const isZh = locale.startsWith('zh') || locale === 'cht'
  const [session, setSession] = useState<Session | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [challengeInput, setChallengeInput] = useState('')
  const seqRef = useRef(0)
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  useEffect(() => {
    setChallengeInput('')
  }, [session?.id])

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
    const req = session.request
    const challengePassed = !req.challengePhrase || challengeInput.trim() === req.challengePhrase.trim()
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || !e.isTrusted) return
      if (e.isComposing || e.keyCode === 229) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // Enter on Cancel / a link activates that control natively, never the confirm action.
      const control = t?.closest('button, a[href]')
      if (control && control.getAttribute('data-modal-initial') !== 'confirm') return
      if (!challengePassed) return
      e.preventDefault()
      e.stopPropagation()
      void runConfirm()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [challengeInput, confirming, runConfirm, session])

  const value = useMemo(() => ({ confirm }), [confirm])

  const req = session?.request
  const confirmVariant: ConfirmVariant = req?.confirmVariant ?? 'accent'
  const challengePassed = !req?.challengePhrase || challengeInput.trim() === req.challengePhrase.trim()

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {req ? (
        <Modal
          open
          title={req.title}
          description={
            <div className="flex flex-col gap-3">
              {req.description ? <div>{req.description}</div> : null}
              {req.challengePhrase ? (
                <div className="flex flex-col gap-2 rounded border border-rose-500/35 bg-rose-500/10 p-3">
                  <div className="flex items-center justify-between text-xs text-rose-300">
                    <span className="font-semibold">{isZh ? '请输入下方短语以确认操作：' : 'Type the following phrase to confirm:'}</span>
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-accent hover:underline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(req.challengePhrase || '')
                        setChallengeInput(req.challengePhrase || '')
                      }}
                    >
                      <IoCopyOutline size={12} aria-hidden />
                      {isZh ? '复制填入' : 'Copy phrase'}
                    </button>
                  </div>
                  <div className="font-mono text-xs font-bold text-rose-200 select-all tracking-wide">{req.challengePhrase}</div>
                  <input
                    type="text"
                    className="mt-0.5 h-8 w-full rounded border border-line bg-panel px-2.5 font-mono text-xs text-ink outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                    placeholder={req.challengePhrase}
                    value={challengeInput}
                    onChange={(e) => setChallengeInput(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : null}
            </div>
          }
          busy={confirming}
          hideCloseButton
          userConfirmOnly
          portalContainer={portalContainer}
          onClose={() => {
            if (!confirming) settle(false)
          }}
          footer={
            <>
              <Button size="lg" variant="ghost" disabled={confirming} onClick={() => settle(false)}>
                {req.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button
                size="lg"
                variant={confirmVariant}
                loading={confirming}
                disabled={confirming || !challengePassed}
                data-modal-initial={challengePassed ? 'confirm' : undefined}
                onClick={(e) => {
                  if (!challengePassed) return
                  if (e.nativeEvent.isTrusted || process.env.NODE_ENV === 'test') void runConfirm()
                }}
              >
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

export function useOptionalConfirm(): ConfirmContextValue['confirm'] | null {
  const ctx = useContext(ConfirmContext)
  return ctx?.confirm ?? null
}
