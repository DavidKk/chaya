'use client'

import { useEffect, useRef, useState } from 'react'
import { IoOpenOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, CopyField, Modal, Spinner, TextInput } from '@/components/sk'
import type { AgentAccountSummary, AgentAuthAttemptView } from '@/lib/game-agent/providers'

import type { AgentSettingsRequest } from './agent-types'

const AUTH_API = '/api/game-agent/auth'
const POLL_WAIT_MS = 25_000

type Props = {
  request: AgentSettingsRequest
  profileId: string
  /** Cursor signs in the machine; the other types authorize one profile. */
  kind: 'login' | 'authorize'
  name: string
  portalContainer?: Element | null
  formatAccount: (account?: AgentAccountSummary) => string
  onClose: () => void
  onFinished: () => void
}

function errorMessage(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

export function AgentAuthDialog({ request, profileId, kind, name, portalContainer, formatAccount, onClose, onFinished }: Props) {
  const t = useT()
  const notify = useNotification()
  const [attempt, setAttempt] = useState<AgentAuthAttemptView | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const attemptRef = useRef<AgentAuthAttemptView | null>(null)
  const startRef = useRef<{ profileId: string; promise: Promise<AgentAuthAttemptView> } | null>(null)
  const mountsRef = useRef(0)
  const callbacks = useRef({ onClose, onFinished, formatAccount })
  callbacks.current = { onClose, onFinished, formatAccount }

  useEffect(() => {
    let active = true
    mountsRef.current += 1
    const settle = (view: AgentAuthAttemptView) => {
      attemptRef.current = view
      if (view.state === 'pending') return false
      if (view.state === 'completed') {
        const account = callbacks.current.formatAccount(view.account)
        notify.success(t(kind === 'login' ? 'agentAuth.loginCompleted' : 'agentAuth.authorizeCompleted', { account }))
        callbacks.current.onFinished()
      } else if (view.state === 'failed') notify.error(view.error?.message || t('agentAuth.cancelled'))
      callbacks.current.onClose()
      return true
    }

    const startAttempt = async () => {
      const response = await request(AUTH_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }) })
      const body = (await response.json().catch(() => null)) as AgentAuthAttemptView | null
      if (!response.ok || !body?.attemptId) throw new Error(errorMessage(body, `HTTP ${response.status}`))
      return body
    }
    const cancelAttempt = (attemptId: string) => void request(`${AUTH_API}/${encodeURIComponent(attemptId)}`, { method: 'DELETE' }).catch(() => undefined)

    void (async () => {
      try {
        if (startRef.current?.profileId !== profileId) startRef.current = { profileId, promise: startAttempt() }
        const body = await startRef.current.promise
        if (!active) return
        setAttempt(body)
        if (settle(body)) return
        while (active) {
          const poll = await request(`${AUTH_API}/${encodeURIComponent(body.attemptId)}?waitMs=${POLL_WAIT_MS}`, { cache: 'no-store' })
          const view = (await poll.json().catch(() => null)) as AgentAuthAttemptView | null
          if (!active) return
          if (!poll.ok || !view?.attemptId) throw new Error(errorMessage(view, `HTTP ${poll.status}`))
          setAttempt(view)
          if (settle(view)) return
        }
      } catch (error) {
        if (!active) return
        notify.error(error instanceof Error ? error.message : String(error))
        callbacks.current.onClose()
      }
    })()

    return () => {
      active = false
      mountsRef.current -= 1
      // A StrictMode / dependency re-run mounts again synchronously and keeps the same attempt; only a real close cancels it.
      setTimeout(() => {
        if (mountsRef.current > 0) return
        const started = startRef.current
        startRef.current = null
        const current = attemptRef.current
        if (current) {
          if (current.state === 'pending') cancelAttempt(current.attemptId)
        } else
          void started?.promise.then(
            (view) => cancelAttempt(view.attemptId),
            () => undefined
          )
      }, 0)
    }
  }, [kind, notify, profileId, request, t])

  const submitCode = async () => {
    const value = code.trim()
    if (!attempt || !value) return
    setSubmitting(true)
    try {
      const response = await request(`${AUTH_API}/${encodeURIComponent(attempt.attemptId)}/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`))
      setCode('')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const challenge = attempt?.state === 'pending' ? attempt.challenge : null
  const title = kind === 'login' ? t('agentAuth.dialogLoginTitle') : t('agentAuth.dialogAuthorizeTitle', { name })

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      portalContainer={portalContainer}
      panelClassName="max-w-[32rem]"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('agentAuth.dialogCancel')}
        </Button>
      }
    >
      {!challenge ? (
        <div className="flex items-center gap-2 text-[0.8125rem] text-ink-soft" role="status">
          <Spinner size="sm" />
          {t('agentAuth.dialogStarting')}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[0.8125rem] text-ink" data-agent-auth-challenge={challenge.kind}>
          <div className="flex flex-col gap-1.5">
            <span>{t('agentAuth.dialogOpenLink')}</span>
            <CopyField value={challenge.url} label={t('agentAuth.dialogOpenLink')} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-soft">{t('agentAuth.dialogOpenLinkAnyDevice')}</span>
              <a
                href={challenge.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <IoOpenOutline size={14} aria-hidden />
                {t('agentAuth.dialogOpen')}
              </a>
            </div>
          </div>
          {challenge.kind === 'device_code' ? (
            <div className="flex flex-col gap-1.5">
              <span>{t('agentAuth.dialogUserCode')}</span>
              <CopyField value={challenge.userCode} label={t('agentAuth.dialogUserCode')} className="[&_input]:text-base [&_input]:tracking-[0.2em]" />
            </div>
          ) : null}
          {challenge.kind === 'callback_code' ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                void submitCode()
              }}
            >
              <span>{t('agentAuth.dialogPasteCode')}</span>
              <div className="flex gap-2">
                <TextInput
                  className="min-w-0 flex-1"
                  value={code}
                  placeholder={t('agentAuth.dialogCodePlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button type="submit" variant="accent" disabled={!code.trim()} loading={submitting}>
                  {t('agentAuth.dialogSubmitCode')}
                </Button>
              </div>
            </form>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-ink-soft" role="status">
            <Spinner size="sm" />
            {t('agentAuth.dialogWaiting')}
          </div>
        </div>
      )}
    </Modal>
  )
}
