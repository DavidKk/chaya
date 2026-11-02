import { marked } from 'marked'
import { notFound } from 'next/navigation'

import { SkillsView } from '@/components/integration/SkillsView'
import { isSkillId, SKILLS } from '@/lib/integration/skills'
import { readSkillBody } from '@/services/integration/skills'

export const dynamicParams = false

export function generateStaticParams() {
  return SKILLS.map((skill) => ({ id: skill.id }))
}

export default async function IntegrationSkillPage({ params }: PageProps<'/integration/skills/[id]'>) {
  const { id } = await params
  if (!isSkillId(id)) notFound()
  /** Trusted repo content, not user input; skills are maintained in English only */
  const html = String(marked.parse(readSkillBody(id), { async: false, gfm: true }))
  return <SkillsView activeId={id} html={html} />
}
