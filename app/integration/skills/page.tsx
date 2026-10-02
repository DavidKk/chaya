import { redirect } from 'next/navigation'

import { integrationSkillHref, SKILLS } from '@/lib/integration/skills'

export default function IntegrationSkillsIndexPage() {
  redirect(integrationSkillHref(SKILLS[0].id))
}
