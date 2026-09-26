import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ slug?: string[] }>
}

/** 旧路径兼容：`/edit…` → `/cheat…` */
export default async function EditCompatRedirect({ params }: Props) {
  const { slug } = await params
  if (!slug?.length) redirect('/cheat/run')
  redirect(`/cheat/${slug.join('/')}`)
}
