import { marked } from 'marked'
import { notFound } from 'next/navigation'

import { SkillsView } from '@/components/integration/SkillsView'
import { isSkillId, SKILLS } from '@/lib/integration/skills'
import { readSkill } from '@/services/integration/skills'

export const dynamicParams = false

export function generateStaticParams() {
  return SKILLS.map((skill) => ({ id: skill.id }))
}

export default async function IntegrationSkillPage({ params }: PageProps<'/integration/skills/[id]'>) {
  const { id } = await params
  if (!isSkillId(id)) notFound()
  const { body } = readSkill(id)
  /** Trusted repo content, not user input */
  const html = marked.parse(body, { async: false, gfm: true })
  return <SkillsView activeId={id} html={html} />
}
