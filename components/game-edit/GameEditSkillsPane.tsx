'use client'

import { marked } from 'marked'
import { useEffect, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuDownload, LuGamepad2, LuPlug } from 'react-icons/lu'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { hubBlock, HubLayout, HubNav, HubNavItem, HubNavSection, HubPaneHeader } from '@/components/integration/Hub'
import { markdownBody } from '@/components/integration/markdown'
import { Spinner } from '@/components/sk'
import { type SkillId, skillRawPath, SKILLS, splitFrontmatter } from '@/lib/integration/skills'
import { cn } from '@/lib/utils'

const SKILL_ICONS: Record<SkillId, IconType> = {
  'chaya-setup': LuDownload,
  'chaya-launch': LuGamepad2,
  'chaya-mcp': LuPlug,
}

/** Skill docs inside the game overlay. Sources come from the connected Chaya service. */
export function GameEditSkillsPane({ request = fetch }: { request?: GameAgentRequest }) {
  const t = useT()
  const locale = useLocaleCode()
  const [activeId, setActiveId] = useState<SkillId>(SKILLS[0].id)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const active = SKILLS.find((skill) => skill.id === activeId) || SKILLS[0]

  useEffect(() => {
    const controller = new AbortController()
    setHtml('')
    setError('')
    void request(skillRawPath(activeId), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const source = await response.text()
        const rendered = marked.parse(splitFrontmatter(source).body, { async: false, gfm: true })
        setHtml(String(rendered))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [activeId, request])

  return (
    <HubLayout
      header={<HubPaneHeader title={active.title[locale]} description={active.summary[locale]} />}
      nav={
        <HubNav label={t('integration.skillsListAria')}>
          <HubNavSection>
            {SKILLS.map((skill) => {
              const Icon = SKILL_ICONS[skill.id]
              return (
                <HubNavItem
                  key={skill.id}
                  active={skill.id === activeId}
                  icon={<Icon size={15} />}
                  label={skill.title[locale]}
                  meta={skill.id}
                  title={skill.summary[locale]}
                  onSelect={() => setActiveId(skill.id)}
                />
              )
            })}
          </HubNavSection>
        </HubNav>
      }
      contentKey={activeId}
      aside={{
        header: <HubPaneHeader title={t('integration.installTitle')} description={t('integration.installEnglishNote')} />,
        children: (
          <section className={hubBlock}>
            <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('integration.installHint')}</p>
            <code className="font-mono text-xs text-ink">{skillRawPath(activeId)}</code>
          </section>
        ),
      }}
    >
      {error ? (
        <section className={cn(hubBlock, 'text-fail')} role="alert">
          {error}
        </section>
      ) : html ? (
        <article className={markdownBody} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <Spinner size="sm" label={t('common.loading')} />
      )}
    </HubLayout>
  )
}
