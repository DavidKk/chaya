'use client'

import { CacheBrowserContent } from '@/components/translate/CacheBrowserContent'
import { useQueryPatch } from '@/lib/url/use-query-patch'

/** Web 页将筛选保存在 URL；局内复用 CacheBrowserContent 的本地查询入口。 */
export function CacheBrowser() {
  const { searchParams, replaceQuery } = useQueryPatch()
  return <CacheBrowserContent searchParams={searchParams} replaceQuery={replaceQuery} />
}
