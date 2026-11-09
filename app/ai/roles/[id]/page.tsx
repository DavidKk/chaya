import { redirect } from 'next/navigation'

export default async function AiRoleDetailPage({ params }: PageProps<'/ai/roles/[id]'>) {
  const { id } = await params
  redirect(`/ai/companion/${encodeURIComponent(id)}`)
}
