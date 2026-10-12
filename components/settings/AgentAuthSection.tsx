'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { formControlInlineStart, formDescInline, formFieldInlineWideLabel, formTitleInline } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Spinner, TextAction, TruncateText } from '@/components/sk'
import { formControlChrome } from '@/components/sk/control'
import type { AgentAccountSummary, AgentAuthStatus, AgentCliStatus, CliAgentProvider } from '@/lib/game-agent/providers'
import { cn } from '@/lib/utils'

import type { AgentSettingsRequest } from './agent-types'
import { AgentAuthDialog } from './AgentAuthDialog'

const AUTH_API = '/api/game-agent/auth'

const DOT = { ok: 'bg-ok', warn: 'bg-warn', fail: 'bg-fail', neutral: 'bg-ink-soft opacity-60' } as const

type ProfileStatus = { cli: AgentCliStatus; auth: AgentAuthStatus }

type Props = {
  request: AgentSettingsRequest
  profileId: string
  provider: CliAgentProvider
  name: string
  /** Saved proxy: status, login and authorization run through it, so a change re-reads the status. */
  savedProxy: string
  /** The form's proxy differs from the saved one; authorizing now would use the old proxy. */
  proxyPending: boolean
}

/** In-game overlay renders inside a shadow root; dialogs must portal there to keep its tokens. */
function shadowHost(el: HTMLElement | null): Element | null {
  const root = el?.getRootNode()
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? (root as unknown as Element) : null
}

export function AgentAuthSection({ request, profileId, provider, name, savedProxy, proxyPending }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const rootRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<ProfileStatus | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const requestId = useRef(0)
  const isCursor = provider === 'cursor'

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    try {
      const response = await request(`${AUTH_API}?profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store' })
      const body = (await response.json().catch(() => null)) as { profiles?: Record<string, ProfileStatus>; error?: { message?: string } } | null
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`)
      if (id === requestId.current) setStatus(body?.profiles?.[profileId] || null)
    } catch (error) {
      if (id === requestId.current) notify.error(error instanceof Error ? error.message : String(error))
    }
  }, [notify, profileId, request])

  useEffect(() => {
    setStatus(null)
    void refresh()
  }, [refresh, provider, savedProxy])

  const formatAccount = useCallback(
    (account?: AgentAccountSummary) => {
      if (account?.emailHint && account.plan) return t('agentAuth.accountWithPlan', { email: account.emailHint, plan: account.plan })
      return account?.emailHint || account?.plan || ''
    },
    [t]
  )

  const logout = async () => {
    const ok = await confirm({
      title: t('agentAuth.logoutTitle'),
      description: isCursor ? t('agentAuth.cursorLogoutDescription') : t('agentAuth.logoutDescription', { name }),
      confirmLabel: t('agentAuth.logout'),
      confirmVariant: 'fail',
    })
    if (!ok) return
    setLoggingOut(true)
    try {
      const response = await request(`${AUTH_API}?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' })
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`)
      await refresh()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoggingOut(false)
    }
  }

  const auth = status?.auth
  const cliMissing = status && !status.cli.found
  const signedIn = (auth?.mode === 'local_login' && auth.state === 'signed_in') || (auth?.mode === 'remote' && auth.state === 'authorized')
  const badge: { tone: keyof typeof DOT; label: string } = cliMissing
    ? { tone: 'fail', label: t('agentAuth.stateCliMissing') }
    : signedIn
      ? { tone: 'ok', label: t('agentAuth.stateAuthorized') }
      : auth?.state === 'expired'
        ? { tone: 'warn', label: t('agentAuth.stateExpired') }
        : auth?.state === 'unknown'
          ? { tone: 'warn', label: t('agentAuth.stateUnknown') }
          : { tone: 'neutral', label: t('agentAuth.stateUnauthorized') }
  const freePlan = isCursor && signedIn && /^free$/i.test(auth?.account?.plan || '')
  const authLabel = t(isCursor ? 'agentAuth.login' : auth?.state === 'expired' ? 'agentAuth.reauthorize' : 'agentAuth.authorize')
  const description = t(proxyPending ? 'agentAuth.proxySaveFirst' : isCursor ? 'agentAuth.cursorUsageWarning' : 'agentAuth.usageWarning')

  return (
    <div ref={rootRef} className={formFieldInlineWideLabel} data-agent-auth-section>
      <span className={formTitleInline}>{t('agentAuth.section')}</span>
      <span className={cn(formDescInline, 'line-clamp-2', proxyPending && 'text-warn')} title={description}>
        {description}
      </span>
      <div className={cn(formControlInlineStart, 'flex flex-col items-stretch gap-2')}>
        <div className={cn(formControlChrome, 'flex w-full min-w-0 items-center gap-2 bg-inset pl-2.5 pr-1.5')} title={status ? badge.label : undefined} data-agent-auth-card>
          {!status ? (
            <span className="inline-flex items-center gap-2 text-xs text-ink-soft" role="status" data-agent-auth-state="checking">
              <Spinner size="sm" />
              {t('agentAuth.checking')}
            </span>
          ) : (
            <>
              <span className={cn('size-1.5 shrink-0 rounded-full', DOT[badge.tone])} aria-hidden />
              <span className="flex min-w-0 flex-1 items-center gap-1.5" role="status">
                {signedIn && auth?.account?.emailHint ? (
                  <>
                    <span className="sr-only">{badge.label}</span>
                    <TruncateText text={auth.account.emailHint} className="min-w-0 text-xs text-ink" data-agent-auth-state={auth.state} />
                  </>
                ) : (
                  <span className="truncate text-xs text-ink-soft" data-agent-auth-state={cliMissing ? 'cli_missing' : auth?.state}>
                    {badge.label}
                  </span>
                )}
                {signedIn && auth?.account?.plan ? <span className="shrink-0 text-[0.68rem] font-medium text-accent">{auth.account.plan}</span> : null}
              </span>
              {cliMissing ? null : signedIn ? (
                <TextAction className="shrink-0 text-xs hover:enabled:text-fail" loading={loggingOut} disabled={proxyPending} onClick={() => void logout()}>
                  {t('agentAuth.logout')}
                </TextAction>
              ) : (
                <TextAction className="shrink-0 text-xs text-accent hover:enabled:text-accent" disabled={proxyPending} onClick={() => setDialogOpen(true)}>
                  {authLabel}
                </TextAction>
              )}
            </>
          )}
        </div>
        {freePlan ? <span className="text-xs text-warn">{t('agentAuth.cursorFreeHint')}</span> : null}
      </div>
      {dialogOpen ? (
        <AgentAuthDialog
          request={request}
          profileId={profileId}
          kind={isCursor ? 'login' : 'authorize'}
          name={name}
          portalContainer={shadowHost(rootRef.current)}
          formatAccount={formatAccount}
          onClose={() => setDialogOpen(false)}
          onFinished={() => void refresh()}
        />
      ) : null}
    </div>
  )
}
