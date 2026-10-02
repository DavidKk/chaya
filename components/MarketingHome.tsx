'use client'

import { ArrowRight, Gamepad2, HardDrive, Languages, Wrench } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FaApple, FaGithub, FaWindows } from 'react-icons/fa'

import { BrandLogo } from '@/components/BrandLogo'
import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { CopyField } from '@/components/sk'
import { DEFAULT_SITE_ORIGIN } from '@/constants/brand'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import type { ReleaseDownloads } from '@/lib/release/github-release'
import { remoteScriptCommand } from '@/lib/remote-scripts/command'
import { cn } from '@/lib/utils'

const MAC_TONE = 'border-line bg-ink text-paper hover:brightness-110'

const DOWNLOAD_IDS = [
  { id: 'mac-arm64', labelKey: 'marketing.downloadMac', chipKey: 'marketing.chipApple', asset: 'macArm64', icon: FaApple, tone: MAC_TONE },
  { id: 'mac-x64', labelKey: 'marketing.downloadMac', chipKey: 'marketing.chipIntel', asset: 'macX64', icon: FaApple, tone: MAC_TONE },
  {
    id: 'win-x64',
    labelKey: 'marketing.downloadWin',
    chipKey: 'marketing.chipX64',
    asset: 'winX64',
    icon: FaWindows,
    tone: 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-accent text-accent-ink hover:brightness-110',
  },
] as const

type DownloadId = (typeof DOWNLOAD_IDS)[number]['id']

type UaDataWithHints = { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> }

/**
 * Only Chromium exposes the CPU via UA Client Hints; Safari / Firefox report "Intel Mac" on
 * Apple silicon too, so no guess is made there and all buttons stay equal.
 */
function useRecommendedDownload(): DownloadId | null {
  const [recommended, setRecommended] = useState<DownloadId | null>(null)
  useEffect(() => {
    const uaData = (navigator as Navigator & { userAgentData?: UaDataWithHints }).userAgentData
    if (uaData?.platform !== 'macOS' || !uaData.getHighEntropyValues) return
    let cancelled = false
    uaData
      .getHighEntropyValues(['architecture'])
      .then(({ architecture }) => {
        if (cancelled) return
        if (architecture === 'arm') setRecommended('mac-arm64')
        else if (architecture === 'x86') setRecommended('mac-x64')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return recommended
}

const subLinkClass =
  'text-ink-soft underline decoration-line underline-offset-2 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'

const FEATURE_DEFS = [
  { labelKey: 'marketing.featureLocal' as const, descKey: 'marketing.featureLocalDesc' as const, icon: HardDrive },
  { labelKey: 'marketing.featureLibrary' as const, descKey: 'marketing.featureLibraryDesc' as const, icon: Gamepad2 },
  { labelKey: 'marketing.featureRealtime' as const, descKey: 'marketing.featureRealtimeDesc' as const, icon: Languages },
  { labelKey: 'marketing.featureIngame' as const, descKey: 'marketing.featureIngameDesc' as const, icon: Wrench },
] as const

const downloadBtnClass = cn(
  'relative inline-flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[0.25rem] border px-3 py-2',
  'font-semibold text-[0.875rem] no-underline',
  'transition-[filter,transform] duration-150 hover:-translate-y-px',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
)

/**
 * Edge（Vercel）官方首页：介绍 + 下载。
 * local / app 不会渲染本页（`/` 直接进 `/game`）。
 */
export function MarketingHome({ githubUrl, downloads }: { githubUrl: string; downloads: ReleaseDownloads }) {
  const t = useT()
  const recommended = useRecommendedDownload()
  const installCommand = remoteScriptCommand(usePageOrigin() || DEFAULT_SITE_ORIGIN, 'install.sh')

  return (
    <div className="fixed inset-0 z-[1] flex flex-col bg-transparent text-ink" aria-label={t('marketing.introAria')}>
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 pt-5 sm:px-10 sm:pt-6">
        <BrandLogo href="/" className="text-lg" markClassName="size-7" priority />
        <div className="flex items-center gap-3">
          <LocaleSwitcher compact />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-ink-soft no-underline transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]"
          >
            <FaGithub aria-hidden className="size-4" />
            GitHub
          </a>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[72rem] flex-1 items-center overflow-y-auto overscroll-contain px-6 py-8 sm:px-10 sm:py-10">
        <div className="grid w-full items-start gap-10 lg:grid-cols-2 lg:gap-14 xl:gap-20">
          <section className="marketing-features order-2 lg:order-1" aria-labelledby="features-title">
            <h2 id="features-title" className="m-0 font-display text-xl font-semibold text-ink sm:text-2xl">
              {t('marketing.featuresTitle')}
            </h2>
            <p className="mt-2 mb-0 max-w-[28rem] text-sm leading-relaxed text-ink-soft sm:text-[0.9375rem]">{t('marketing.featuresCopy')}</p>

            <ul className="mt-7 m-0 grid list-none grid-cols-1 gap-x-8 gap-y-6 p-0 sm:mt-8 sm:grid-cols-2 sm:gap-y-8">
              {FEATURE_DEFS.map((item, index) => (
                <li key={item.labelKey} className="marketing-feature flex min-w-0 flex-col gap-2.5" style={{ animationDelay: `${0.08 + index * 0.05}s` }}>
                  <span className="inline-flex size-8 items-center justify-center text-accent">
                    <item.icon aria-hidden className="size-5" strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(item.labelKey)}</h3>
                    <p className="mt-1.5 mb-0 text-sm leading-relaxed text-ink-soft">{t(item.descKey)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="marketing-hero relative order-1 flex flex-col lg:order-2" aria-labelledby="hero-title">
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-[38%] h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent)_18%,transparent)_0%,transparent_68%)] blur-2xl lg:left-[42%] lg:h-[22rem] lg:w-[22rem]"
            />

            <h1 id="hero-title" className="relative m-0">
              <BrandLogo
                animated
                className="gap-4 text-4xl sm:gap-5 sm:text-5xl lg:gap-6 lg:text-6xl"
                markClassName="size-[3.75rem] sm:size-[4.5rem] lg:size-[5.25rem]"
                wordmarkClassName="leading-none tracking-tight"
                priority
              />
            </h1>

            <p className="marketing-hero-line relative mt-6 mb-0 max-w-[18em] font-display text-[1.35rem] font-medium leading-snug text-ink sm:mt-7 sm:text-[1.65rem]">
              {t('marketing.heroLine')}
            </p>
            <p className="marketing-hero-copy relative mt-2.5 mb-0 max-w-[28rem] text-sm leading-relaxed text-ink-soft sm:text-[0.9375rem]">{t('marketing.heroCopy')}</p>

            <div id="download" className="marketing-hero-cta relative mt-7 grid w-full max-w-[28rem] grid-cols-1 gap-2.5 sm:mt-8 sm:grid-cols-3">
              {DOWNLOAD_IDS.map((item) => {
                const isRecommended = recommended === item.id
                return (
                  <a
                    key={item.id}
                    id={`download-${item.id}`}
                    href={downloads[item.asset] ?? downloads.pageUrl}
                    className={cn(downloadBtnClass, item.tone, isRecommended && 'ring-2 ring-accent ring-offset-2 ring-offset-paper')}
                  >
                    {isRecommended ? (
                      <span className="absolute -top-2 right-2 rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-semibold leading-tight text-accent-ink">
                        {t('marketing.recommended')}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-2">
                      <item.icon aria-hidden className="size-4" />
                      {t(item.labelKey)}
                    </span>
                    <span className="text-[0.7rem] font-medium opacity-70">{t(item.chipKey)} · .zip</span>
                  </a>
                )
              })}
            </div>

            <div className="marketing-hero-cta relative mt-3 flex w-full max-w-[28rem] flex-col gap-1.5 text-xs leading-relaxed text-ink-soft">
              <p className="m-0">
                <a href={downloads.pageUrl} target="_blank" rel="noreferrer" className={subLinkClass}>
                  {downloads.version ? `${t('marketing.allReleases')} · ${downloads.version}` : t('marketing.allReleases')}
                </a>
              </p>
              <p className="m-0">{t('marketing.macFirstLaunch')}</p>
              <CopyField value={installCommand} label={t('marketing.macInstallAria')} />
            </div>

            <div className="marketing-hero-link relative mt-6 flex w-full max-w-[28rem] flex-col gap-2.5">
              <div className="flex w-full items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-line-soft" />
                <span className="text-xs tracking-wide text-ink-soft">{t('marketing.orTryBrowser')}</span>
                <span className="h-px flex-1 bg-line-soft" />
              </div>
              <Link
                href="/game"
                className="group inline-flex items-center gap-1.5 self-start rounded-[0.25rem] text-sm font-medium text-accent no-underline transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]"
              >
                {t('marketing.openConsole')}
                <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </section>
        </div>
      </main>

      <style>{`
        @keyframes marketing-rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .marketing-hero > *:not([aria-hidden]),
        .marketing-features > :is(h2, p),
        .marketing-feature {
          animation: marketing-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .marketing-hero-line { animation-delay: 0.08s; }
        .marketing-hero-copy { animation-delay: 0.14s; }
        .marketing-hero-cta { animation-delay: 0.2s; }
        .marketing-hero-link { animation-delay: 0.26s; }
        .marketing-features > h2 { animation-delay: 0.06s; }
        .marketing-features > p { animation-delay: 0.1s; }
        @media (prefers-reduced-motion: reduce) {
          .marketing-hero > *:not([aria-hidden]),
          .marketing-features > :is(h2, p),
          .marketing-feature { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
