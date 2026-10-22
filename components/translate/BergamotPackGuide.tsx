'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, Button, Spinner } from '@/components/sk'
import { isActivePackJob, type PackPlan } from '@/lib/translate/bergamot'

/** Presentation shared by the installer and development previews; never performs I/O. */
export function BergamotPackGuide({
  plan,
  error = '',
  busy = false,
  onAction,
}: {
  plan?: PackPlan
  error?: string
  busy?: boolean
  onAction: (action: 'install' | 'cancel' | 'plan') => void
}) {
  const t = useT()
  const active = !!plan?.job && isActivePackJob(plan.job)
  const job = plan?.job
  const failed = job?.state === 'failed' || job?.state === 'interrupted'
  const percent = job?.totalDownloadBytes ? Math.min(100, Math.round((job.downloadedBytes / job.totalDownloadBytes) * 100)) : 0
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3 text-xs leading-relaxed text-ink-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink">Bergamot</span>
        <Badge size="mini" loading={!plan && !error} tone={plan?.installed ? 'ok' : failed ? 'fail' : active ? 'accent' : 'warn'}>
          {t(
            !plan && !error
              ? 'translate.offlineChecking'
              : plan?.installed
                ? 'translate.tagReady'
                : active
                  ? job?.phase === 'downloading'
                    ? 'translate.packDownloading'
                    : 'translate.packVerifying'
                  : 'translate.tagNotReady'
          )}
        </Badge>
      </div>
      {plan ? (
        <div className="font-mono text-[11px] uppercase text-ink-soft">
          {plan.source} → {plan.target}
        </div>
      ) : null}
      {!plan && !error ? (
        <span className="flex items-center gap-2">
          <Spinner size="sm" />
          {t('translate.offlineChecking')}
        </span>
      ) : null}
      {error ? (
        <p className="m-0 break-words text-fail" role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <>
          {!active ? (
            <p className="m-0">
              {t(
                plan.installed
                  ? 'translate.offlineReadyHint'
                  : plan.status === 'component_unavailable'
                    ? 'translate.bergamotUnavailable'
                    : plan.status === 'same_language' || plan.status === 'unsupported_pair' || plan.status === 'platform_unsupported'
                      ? 'translate.offlineUnsupportedPair'
                      : 'translate.packInstallHint'
              )}
            </p>
          ) : null}
          {plan.packs.map((pack) => (
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
            <div className="flex flex-col gap-2 rounded-lg bg-inset p-2.5" aria-live="polite">
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
              <span>
                {(job.downloadedBytes / 1048576).toFixed(1)} / {(job.totalDownloadBytes / 1048576).toFixed(1)} MB
              </span>
            </div>
          ) : null}
          {job && ['failed', 'interrupted', 'cancelled'].includes(job.state) ? (
            <p className={failed ? 'm-0 rounded-lg bg-fail/10 p-2 text-fail' : 'm-0 rounded-lg bg-inset p-2'} role="status">
              {t('translate.packRetryHint')}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button size="xs" loading={busy} onClick={() => onAction('cancel')}>
            {t('common.cancel')}
          </Button>
        ) : plan?.canInstall ? (
          <Button size="xs" variant="accent" loading={busy} onClick={() => onAction('install')}>
            {t('translate.packInstall')}
          </Button>
        ) : null}
        {!active ? (
          <Button size="xs" loading={busy} onClick={() => onAction('plan')}>
            {t('translate.offlineRecheck')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
