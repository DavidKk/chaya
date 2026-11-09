import { AiRolesRoute } from '@/components/ai/AiRolesRoute'

export default async function AiCompanionDetailPage({ params }: PageProps<'/ai/companion/[id]'>) {
  const { id } = await params
  return <AiRolesRoute roleId={id} />
}
