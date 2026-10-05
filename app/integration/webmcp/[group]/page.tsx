import { notFound } from 'next/navigation'

import { WebMcpView } from '@/components/integration/webmcp/WebMcpView'
import { WEBMCP_GROUP_SLUGS } from '@/lib/webmcp/registrars'

const SLUGS: readonly string[] = Object.values(WEBMCP_GROUP_SLUGS)

export const dynamicParams = false

export function generateStaticParams() {
  return SLUGS.map((group) => ({ group }))
}

export default async function IntegrationWebMcpGroupPage({ params }: PageProps<'/integration/webmcp/[group]'>) {
  const { group } = await params
  if (!SLUGS.includes(group)) notFound()
  return <WebMcpView route={{ base: '/integration/webmcp', section: group }} />
}
