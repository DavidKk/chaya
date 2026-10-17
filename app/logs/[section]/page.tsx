import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { LogsSectionView } from '@/components/logs/LogsSectionView'
import { DEFAULT_LOGS_SECTION, isLogsSection, logsSectionHref } from '@/components/logs/sections'

type Props = { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export function generateStaticParams() {
  return [{ section: 'runtime' }, { section: 'agent' }, { section: 'cli' }]
}

/** Legacy `?view=` → slash path; keep filters like `taskId` / `q`. */
export default async function LogsSectionPage({ params, searchParams }: Props) {
  const { section } = await params
  const query = await searchParams
  const legacyView = typeof query.view === 'string' ? query.view : undefined
  if (legacyView && isLogsSection(legacyView) && legacyView !== section) {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (key === 'view' || value == null) continue
      if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
      else next.set(key, value)
    }
    const qs = next.toString()
    redirect(qs ? `${logsSectionHref(legacyView)}?${qs}` : logsSectionHref(legacyView))
  }
  if (!isLogsSection(section)) redirect(logsSectionHref(DEFAULT_LOGS_SECTION))
  return (
    <Suspense fallback={null}>
      <LogsSectionView />
    </Suspense>
  )
}
