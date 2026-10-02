import { redirect } from 'next/navigation'

import { INTEGRATION_SKILLS_PATH } from '@/lib/integration/skills'

export default function IntegrationIndexPage() {
  redirect(INTEGRATION_SKILLS_PATH)
}
