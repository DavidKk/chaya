import { redirect } from 'next/navigation'

import { DEFAULT_LOGS_SECTION, isLogsSection, logsSectionHref } from '@/components/logs/sections'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** `/logs` and legacy `/logs?view=` → `/logs/{section}` */
export default async function LogsIndexPage({ searchParams }: Props) {
  const query = await searchParams
  const legacyView = typeof query.view === 'string' && isLogsSection(query.view) ? query.view : DEFAULT_LOGS_SECTION
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key === 'view' || value == null) continue
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
    else next.set(key, value)
  }
  const qs = next.toString()
  redirect(qs ? `${logsSectionHref(legacyView)}?${qs}` : logsSectionHref(legacyView))
}
