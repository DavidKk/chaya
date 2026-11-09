import { redirect } from 'next/navigation'

export default async function AgentSettingsDetailPage({ params }: PageProps<'/assist/agents/[id]'>) {
  const { id } = await params
  redirect(`/ai/agents/${encodeURIComponent(id)}`)
}
