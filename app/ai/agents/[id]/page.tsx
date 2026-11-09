import { AgentSettingsRoute } from '@/components/settings/AgentSettingsRoute'

export default async function AiAgentDetailPage({ params }: PageProps<'/ai/agents/[id]'>) {
  const { id } = await params
  return <AgentSettingsRoute agentId={id} />
}
