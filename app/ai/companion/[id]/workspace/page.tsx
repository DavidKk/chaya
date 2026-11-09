import { RoleWorkspaceRoute } from '@/components/ai/RoleWorkspaceRoute'

export default async function AiRoleWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoleWorkspaceRoute roleId={id} />
}
