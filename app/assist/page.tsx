import { redirect } from 'next/navigation'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function AssistPage({ searchParams }: Props = {}) {
  const query = searchParams ? await searchParams : {}
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
    else if (typeof value === 'string') next.set(key, value)
  }
  const qs = next.toString()
  redirect(qs ? `/assist/hotkeys?${qs}` : '/assist/hotkeys')
}
