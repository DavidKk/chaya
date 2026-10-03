import { marked } from 'marked'
import { notFound } from 'next/navigation'

import { SkillsView } from '@/components/integration/SkillsView'
import { type Locale, LOCALES } from '@/lib/i18n/locales'
import { isSkillId, SKILLS } from '@/lib/integration/skills'
import { readSkillBody } from '@/services/integration/skills'

export const dynamicParams = false

export function generateStaticParams() {
  return SKILLS.map((skill) => ({ id: skill.id }))
}

export default async function IntegrationSkillPage({ params }: PageProps<'/integration/skills/[id]'>) {
  const { id } = await params
  if (!isSkillId(id)) notFound()
  /** Trusted repo content, not user input; every locale is rendered because the locale is chosen client-side */
  const html = Object.fromEntries(LOCALES.map((locale) => [locale, marked.parse(readSkillBody(id, locale), { async: false, gfm: true })])) as Record<Locale, string>
  return <SkillsView activeId={id} html={html} />
}
