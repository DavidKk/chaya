'use client'

import { FaGithub } from 'react-icons/fa'

import { BrandLogo } from '@/components/BrandLogo'
import { useT } from '@/components/i18n/LocaleProvider'
import { CopyField } from '@/components/sk'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import { REMOTE_SCRIPT_PREFIX, remoteScriptCommand, type RemoteScriptName } from '@/lib/remote-scripts/command'

const TITLE_KEYS = {
  'install.sh': 'remoteScript.installTitle',
  'mac-shell.sh': 'remoteScript.macShellTitle',
} as const satisfies Record<RemoteScriptName, string>

/** Read-only "editor" for a served script: one-liner on top, highlighted source below. */
export function RemoteScriptView({ name, html, lineCount, githubUrl }: { name: RemoteScriptName; html: string; lineCount: number; githubUrl: string }) {
  const t = useT()
  const origin = usePageOrigin()
  const command = origin ? remoteScriptCommand(origin, name) : ''

  return (
    <div className="fixed inset-0 z-[1] overflow-y-auto overscroll-contain text-ink">
      <div className="mx-auto flex w-full max-w-[60rem] flex-col gap-6 px-6 py-6 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between gap-4">
          <BrandLogo href="/" className="text-lg" markClassName="size-7" />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-ink-soft no-underline transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <FaGithub aria-hidden className="size-4" />
            GitHub
          </a>
        </header>

        <section className="flex flex-col gap-3" aria-labelledby="script-title">
          <h1 id="script-title" className="m-0 font-display text-2xl font-semibold">
            {t(TITLE_KEYS[name])}
          </h1>
          <p className="m-0 text-sm text-ink-soft">{t('remoteScript.runHint')}</p>
          <CopyField value={command} label={t('remoteScript.commandAria')} />
        </section>

        <section className="overflow-hidden rounded-md border border-line bg-panel" aria-label={t('remoteScript.sourceAria')}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-xs text-ink-soft">
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex gap-2">
                <span className="size-2.5 rounded-full bg-fail/70" />
                <span className="size-2.5 rounded-full bg-warn/70" />
                <span className="size-2.5 rounded-full bg-ok/70" />
              </span>
              <span className="font-mono text-ink">{name}</span>
              <span>· {t('remoteScript.lines', { count: lineCount })}</span>
            </span>
            <a href={`${REMOTE_SCRIPT_PREFIX}${name}?raw=1`} className="text-ink-soft underline underline-offset-2 hover:text-ink">
              {t('remoteScript.viewRaw')}
            </a>
          </div>
          <div className="remote-script-code overflow-x-auto py-3 text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        </section>
      </div>

      <style>{`
        .remote-script-code pre { margin: 0; background: transparent !important; counter-reset: line; }
        .remote-script-code code { display: block; min-width: max-content; font-family: var(--font-mono); }
        .remote-script-code .line { display: inline-block; width: 100%; padding-right: 1rem; }
        .remote-script-code .line::before {
          counter-increment: line;
          content: counter(line);
          display: inline-block;
          width: 3rem;
          margin-right: 1rem;
          padding-right: 0.75rem;
          text-align: right;
          color: var(--ink-soft);
          opacity: 0.5;
          user-select: none;
        }
      `}</style>
    </div>
  )
}
