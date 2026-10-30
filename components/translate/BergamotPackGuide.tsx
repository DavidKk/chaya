'use client'

import { LuArrowRight } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, Button, Spinner } from '@/components/sk'
import { isActivePackJob, packJobError, type PackPlan } from '@/lib/translate/bergamot'
import { formatLanguageLabel } from '@/lib/translate/locales-labels'

/** Presentation shared by the installer and development previews; never performs I/O. */
export function BergamotPackGuide({
  plan,
  error = '',
  busy = false,
  /** When true, omit title/badge/pair chrome — parent already shows offline status. */
  embedded = false,
  onAction,
}: {
  plan?: PackPlan
  error?: string
  busy?: boolean
  embedded?: boolean
  onAction: (action: 'install' | 'reinstall' | 'cancel' | 'plan') => void
}) {
  const t = useT()
  const active = !!plan?.job && isActivePackJob(plan.job)
  const job = plan?.job
  const failed = job?.state === 'failed' || job?.state === 'interrupted'
  const failureCode = job ? packJobError(job) : undefined
  const failureReason = failureCode === 'PACK_DOWNLOAD_FAILED' || failureCode === 'PACK_DOWNLOAD_TIMEOUT' ? t('translate.packDownloadFailed') : failureCode
  const percent = job?.totalDownloadBytes ? Math.min(100, Math.round((job.downloadedBytes / job.totalDownloadBytes) * 100)) : 0
  const checking = !plan && !error
  /** Checking state lives on the 检测 button — no separate spinner / badge copy. */
  const showRecheck = !embedded && !active
  const showActions = !active && (!!plan?.canInstall || !!plan?.installed || showRecheck)
  return (
    <div
      className={
        embedded
          ? 'flex flex-col gap-3 text-xs leading-relaxed text-ink-soft'
          : 'flex flex-col gap-3 rounded-xl border border-line bg-panel p-3 text-xs leading-relaxed text-ink-soft'
      }
      aria-busy={checking || undefined}
    >
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-ink">Bergamot</span>
          {plan || error ? (
            <Badge size="mini" tone={plan?.installed ? 'ok' : failed ? 'fail' : active ? 'accent' : 'warn'}>
              {t(
                plan?.installed ? 'translate.tagReady' : active ? (job?.phase === 'downloading' ? 'translate.packDownloading' : 'translate.packVerifying') : 'translate.tagNotReady'
              )}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {!embedded && plan ? (
        <div className="inline-flex flex-wrap items-center gap-1 text-ink-soft">
          {formatLanguageLabel(plan.source)}
          <LuArrowRight className="size-3 shrink-0" aria-hidden />
          {formatLanguageLabel(plan.target)}
        </div>
      ) : null}
      {error ? (
        <p className="m-0 break-words text-fail" role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <>
          {!active && !plan.installed ? (
            <p className="m-0">
              {t(
                plan.status === 'component_unavailable'
                  ? 'translate.bergamotUnavailable'
                  : plan.status === 'same_language' || plan.status === 'unsupported_pair' || plan.status === 'platform_unsupported'
                    ? 'translate.offlineUnsupportedPair'
                    : 'translate.packInstallHint'
              )}
            </p>
          ) : null}
          {plan.packs?.map((pack) => (
            <p key={pack.id} className="m-0 break-words text-[11px]">
              {pack.attribution} ·{' '}
              {pack.licenseUrl ? (
                <a href={pack.licenseUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  {pack.license}
                </a>
              ) : (
                pack.license
              )}{' '}
              · {(pack.bytes / 1048576).toFixed(1)} MB
            </p>
          ))}
          {active && job ? (
            <div className={`flex flex-col gap-2 rounded-lg p-2.5 ${embedded ? 'bg-panel' : 'bg-inset'}`} aria-live="polite">
              <span className="flex items-center gap-2">
                {job.phase !== 'downloading' ? <Spinner size="sm" label={t('translate.packVerifying')} className="motion-reduce:animate-none" /> : null}
                {t(job.phase === 'downloading' || job.state === 'queued' ? 'translate.packDownloading' : 'translate.packVerifying')}
                {job.phase === 'downloading' ? ` · ${percent}%` : ''}
              </span>
              <div
                role="progressbar"
                aria-label={t(job.phase === 'downloading' ? 'translate.packDownloading' : 'translate.packVerifying')}
                aria-busy={job.phase !== 'downloading' ? true : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.phase === 'downloading' ? percent : undefined}
                className="h-1.5 overflow-hidden rounded-full bg-line"
              >
                <div
                  className={
                    job.phase === 'downloading'
                      ? 'h-full bg-accent transition-[width] motion-reduce:transition-none'
                      : 'h-full w-full animate-pulse bg-accent/55 motion-reduce:animate-none'
                  }
                  style={job.phase === 'downloading' ? { width: `${percent}%` } : undefined}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>
                  {(job.downloadedBytes / 1048576).toFixed(1)} / {(job.totalDownloadBytes / 1048576).toFixed(1)} MB
                </span>
                <Button size="xs" loading={busy} onClick={() => onAction('cancel')}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
          {failed ? (
            <p className={plan.installed ? 'm-0 rounded-lg bg-inset p-2' : 'm-0 rounded-lg bg-fail/10 p-2 text-fail'} role="status">
              {t(plan.installed ? 'translate.packReinstallFailed' : 'translate.packRetryHint')}
              {failureReason ? ` ${failureReason}` : ''}
            </p>
          ) : null}
        </>
      ) : null}
      {showActions ? (
        <div className="flex flex-wrap gap-2">
          {plan?.canInstall ? (
            <Button size="xs" variant="accent" loading={busy} onClick={() => onAction('install')}>
              {t('translate.packInstall')}
            </Button>
          ) : plan?.installed ? (
            <Button size="xs" loading={busy} onClick={() => onAction('reinstall')}>
              {t('translate.packReinstall')}
            </Button>
          ) : null}
          {showRecheck ? (
            <Button size="xs" loading={busy || checking} disabled={busy || checking} onClick={() => onAction('plan')}>
              {t('translate.offlineRecheck')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
