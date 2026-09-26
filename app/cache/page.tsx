import { redirect } from 'next/navigation'

import { translateTabHref } from '@/components/translate/tabs'

/** 旧路径兼容：`/cache` → `/translate/cache` */
export default function CacheRedirectPage() {
  redirect(translateTabHref('cache'))
}
