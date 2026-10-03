'use client'

import type { IconType } from 'react-icons'
import { LuDownload, LuGamepad2, LuPlug } from 'react-icons/lu'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { hubBlock, HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { markdownBody } from '@/components/integration/markdown'
import { SkillInstall } from '@/components/integration/SkillInstall'
import type { Locale } from '@/lib/i18n/locales'
import { integrationSkillHref, type SkillId, SKILLS } from '@/lib/integration/skills'
import { cn } from '@/lib/utils'

const SKILL_ICONS: Record<SkillId, IconType> = {
  'chaya-setup': LuDownload,
  'chaya-launch': LuGamepad2,
  'chaya-mcp': LuPlug,
}

/** Skills 子页：左半「skill 列表 + 正文」（构建期渲染的 HTML），右半「安装到 Agent」 */
export function SkillsView({ activeId, html }: { activeId: SkillId; html: Record<Locale, string> }) {
  const t = useT()
  const locale = useLocaleCode()
  const active = SKILLS.find((skill) => skill.id === activeId) ?? SKILLS[0]

  return (
    <HubLayout
      header={
        <HubPaneHeader
          title={active.title[locale]}
          description={
            <>
              {active.summary[locale]} <code className="font-mono text-[11px]">{active.id}</code>
            </>
          }
        />
      }
      nav={
        <HubNav label={t('integration.skillsListAria')}>
          <HubNavSection>
            {SKILLS.map((skill) => {
              const Icon = SKILL_ICONS[skill.id]
              return (
                <HubNavItem
                  key={skill.id}
                  href={integrationSkillHref(skill.id)}
                  active={skill.id === activeId}
                  icon={<Icon size={15} />}
                  label={skill.title[locale]}
                  meta={skill.id}
                  title={skill.summary[locale]}
                />
              )
            })}
          </HubNavSection>
        </HubNav>
      }
      contentKey={activeId}
      aside={{
        header: <HubPaneHeader title={t('integration.installTitle')} description={t('integration.installHint')} />,
        children: <SkillInstall id={activeId} />,
      }}
    >
      <section className={cn(hubBlock, 'md:hidden')} aria-label={t('integration.installTitle')}>
        <h2 className="m-0 text-[13px] font-semibold text-ink">{t('integration.installTitle')}</h2>
        <SkillInstall id={activeId} />
      </section>
      <article className={markdownBody} dangerouslySetInnerHTML={{ __html: html[locale] ?? html.en }} />
    </HubLayout>
  )
}
