import { redirect } from 'next/navigation'

export default async function AgentSettingsDetailPage({ params }: PageProps<'/settings/agents/[id]'>) {
  const { id } = await params
  redirect(`/assist/agents/${encodeURIComponent(id)}`)
}
