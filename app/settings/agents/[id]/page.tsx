import { AgentSettingsRoute } from '@/components/settings/AgentSettingsRoute'

export default async function AgentSettingsDetailPage({ params }: PageProps<'/settings/agents/[id]'>) {
  const { id } = await params
  return <AgentSettingsRoute agentId={id} />
}
