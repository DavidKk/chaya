'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLayoutEffect } from 'react'

import { commitNavigationRestoration, initializeNavigationRestoration } from '@/lib/ui/navigation-restoration'

// Install before hydration: Next's initial replaceState must preserve reload metadata.
if (typeof window !== 'undefined') initializeNavigationRestoration()

/** History identities are created by the shared scroll registry; commit after route rendering. */
export function NavigationRestoration() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useLayoutEffect(() => {
    commitNavigationRestoration()
  }, [pathname, search])
  return null
}
