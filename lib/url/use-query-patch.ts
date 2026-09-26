'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { hrefWithQuery, patchSearchParams } from '@/lib/url/search-params'

/** 用 `router.replace` 写入 filter query，不滚动；query 未变则不导航（避免 Suspense 整页闪骨架）。 */
export function useQueryPatch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const replaceQuery = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const query = patchSearchParams(searchParams, patch)
      const current = searchParams.toString()
      if (query === current) return
      router.replace(hrefWithQuery(pathname, query), { scroll: false })
    },
    [pathname, router, searchParams]
  )

  return { pathname, searchParams, replaceQuery }
}
