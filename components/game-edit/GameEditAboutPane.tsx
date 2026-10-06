'use client'

import type { IconType } from 'react-icons'
import { LuBug, LuExternalLink, LuFileCode2, LuGithub, LuGlobe, LuHeartHandshake, LuInfo, LuScale, LuShieldCheck } from 'react-icons/lu'

import { BrandMarkInline } from '@/components/BrandMarkInline'
import { useT } from '@/components/i18n/LocaleProvider'
import { integrationCard } from '@/components/integration/mcp/McpConnectionCard'
import { CreditsList } from '@/components/legal/CreditsList'
import { LegalDocBody } from '@/components/legal/LegalDocBody'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import { PRODUCT_DISPLAY_NAME } from '@/constants/brand'
import { GITHUB_ISSUES_URL, GITHUB_URL, openExternal, PRODUCT_VERSION, SITE_URL } from '@/lib/about'
import type { MessageKey } from '@/lib/i18n'
import { useViewState } from '@/lib/view-state'

const SECTIONS = [
  { id: 'intro', labelKey: 'about.intro', icon: LuInfo },
  { id: 'credits', labelKey: 'credits.title', icon: LuHeartHandshake },
  { id: 'disclaimer', labelKey: 'legal.title', icon: LuScale },
  { id: 'privacy', labelKey: 'legal.privacy', icon: LuShieldCheck },
  { id: 'license', labelKey: 'legal.license', icon: LuFileCode2 },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const isSectionId = (v: unknown): v is SectionId => SECTIONS.some((item) => item.id === v)

const USAGE_KEYS = ['about.usagePanel', 'about.usageEdit', 'about.usageTranslate', 'about.usageAgent', 'about.usageConsole'] as const satisfies readonly MessageKey[]

const LINKS: ReadonlyArray<{ id: string; labelKey: MessageKey; url: string; icon: IconType }> = [
  { id: 'github', labelKey: 'about.github', url: GITHUB_URL, icon: LuGithub },
  { id: 'site', labelKey: 'about.site', url: SITE_URL, icon: LuGlobe },
  { id: 'issues', labelKey: 'about.issues', url: GITHUB_ISSUES_URL, icon: LuBug },
]

function AboutIntro() {
  const t = useT()
  return (
    <div className="flex w-full max-w-[44rem] flex-col gap-4">
      <header className="flex items-center gap-3">
        <BrandMarkInline className="size-10" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 flex items-baseline gap-2 font-display text-xl font-semibold text-ink">
            {PRODUCT_DISPLAY_NAME}
            <span className="text-xs font-normal text-ink-soft">{t('about.version', { version: PRODUCT_VERSION })}</span>
            <span className="self-center rounded-[0.3rem] border border-[color-mix(in_oklab,var(--accent)_38%,transparent)] px-1.5 py-px font-sans text-[0.6875rem] font-medium text-accent">
              {t('about.openSource')}
            </span>
          </h1>
          <p className="m-0 text-sm text-ink-soft">{t('about.tagline')}</p>
        </div>
      </header>
      <p className="m-0 text-sm leading-relaxed text-ink">{t('about.description')}</p>

      <section className={integrationCard} aria-labelledby="about-usage">
        <h2 id="about-usage" className="m-0 text-[0.9375rem] font-semibold text-ink">
          {t('about.usageTitle')}
        </h2>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-soft marker:text-ink-soft">
          {USAGE_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>

      <section className={integrationCard} aria-labelledby="about-links">
        <h2 id="about-links" className="m-0 text-[0.9375rem] font-semibold text-ink">
          {t('about.linksTitle')}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {LINKS.map((link) => (
            <li key={link.id}>
              <button
                type="button"
                data-about-link={link.id}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded-[0.35rem] border-0 bg-transparent px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]"
                onClick={() => openExternal(link.url)}
              >
                <link.icon size={16} aria-hidden className="shrink-0 text-ink-soft" />
                <span className="shrink-0 font-medium">{t(link.labelKey)}</span>
                <span className="min-w-0 truncate text-xs text-ink-soft">{link.url.replace(/^https:\/\//, '')}</span>
                <LuExternalLink size={13} aria-hidden className="ml-auto shrink-0 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="m-0 text-xs text-ink-soft">{t('about.license')}</p>
    </div>
  )
}

/** 局内「关于」：介绍（使用方式与链接）+ 免责声明全文 */
export function GameEditAboutPane() {
  const t = useT()
  const [section, setSection] = useViewState<SectionId>('about.section', 'intro', isSectionId)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper md:flex-row">
      <SectionSideNav label={t('about.sections')} mobile>
        {SECTIONS.map((item) => {
          const active = section === item.id
          const label = t(item.labelKey)
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} className={sectionSideNavItemClass(active)} onClick={() => setSection(item.id)}>
                  <SectionSideNavItemContent active={active} icon={<item.icon size={17} />} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {section === 'intro' ? (
          <AboutIntro />
        ) : section === 'credits' ? (
          <div className="flex w-full max-w-[44rem] flex-col gap-6">
            <h1 className="m-0 font-display text-2xl font-semibold text-ink">{t('credits.title')}</h1>
            <CreditsList />
          </div>
        ) : (
          <LegalDocBody id={section} className="max-w-[44rem]" />
        )}
      </div>
    </div>
  )
}
