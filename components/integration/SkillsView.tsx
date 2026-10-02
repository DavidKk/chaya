'use client'

import Link from 'next/link'
import { LuExternalLink } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { markdownBody } from '@/components/integration/markdown'
import { SkillInstall } from '@/components/integration/SkillInstall'
import { ScrollArea } from '@/components/sk'
import { integrationSkillHref, type SkillId, skillRawPath, SKILLS } from '@/lib/integration/skills'
import { cn } from '@/lib/utils'

/** Skills 子页：左侧 skill 列表，右侧安装命令 + 正文（构建期渲染的 HTML） */
export function SkillsView({ activeId, html }: { activeId: SkillId; html: string }) {
  const t = useT()
  const note = t('integration.contentNote')

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label={t('integration.skillsListAria')} className="shrink-0 border-b border-line md:w-64 md:border-r md:border-b-0">
        <ul className="m-0 flex list-none flex-row gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
          {SKILLS.map((skill) => {
            const active = skill.id === activeId
            return (
              <li key={skill.id} className="min-w-48 md:min-w-0">
                <Link
                  href={integrationSkillHref(skill.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-[0.3rem] px-3 py-2 no-underline transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    active ? 'bg-paper-2 text-ink' : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
                  )}
                >
                  <span className="text-[13px] font-semibold">{skill.title}</span>
                  <span className="text-xs leading-snug text-ink-soft">{skill.summary}</span>
                  <code className="mt-0.5 font-mono text-[11px] text-ink-soft">{skill.id}</code>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href={skillRawPath(activeId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline"
            >
              {t('integration.viewRaw')}
              <LuExternalLink aria-hidden className="size-3.5" />
            </a>
          </div>
          <SkillInstall id={activeId} />
          {note ? <p className="m-0 text-xs text-ink-soft">{note}</p> : null}
          <article className={markdownBody} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </ScrollArea>
    </div>
  )
}
