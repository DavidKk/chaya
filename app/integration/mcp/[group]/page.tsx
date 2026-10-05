import { notFound } from 'next/navigation'

import { McpView } from '@/components/integration/mcp/McpView'
import { MCP_TOOL_GROUPS } from '@/lib/integration/mcp-catalog'

export const dynamicParams = false

export function generateStaticParams() {
  return MCP_TOOL_GROUPS.map((group) => ({ group: group.id }))
}

export default async function IntegrationMcpGroupPage({ params }: PageProps<'/integration/mcp/[group]'>) {
  const { group } = await params
  if (!MCP_TOOL_GROUPS.some((candidate) => candidate.id === group)) notFound()
  return <McpView route={{ base: '/integration/mcp', section: group }} />
}
