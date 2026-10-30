import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ slug?: string[] }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

/** 旧路径兼容：`/edit…` → `/cheat…` */
export default async function EditCompatRedirect({ params, searchParams }: Props = { params: Promise.resolve({}) }) {
  const [{ slug }, query] = await Promise.all([params, searchParams ? searchParams : Promise.resolve({})])
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
    else if (typeof value === 'string') next.set(key, value)
  }
  const qs = next.toString()
  const base = !slug?.length ? '/cheat/run' : `/cheat/${slug.join('/')}`
  redirect(qs ? `${base}?${qs}` : base)
}
