'use client'

import { useViewState } from '@/lib/view-state'

/** Web page route for a hub's sections: `base` is the overview, `base/<section>` a group (empty section = overview) */
export type HubRoute = { base: string; section: string }

type NavTarget = { href: string; onSelect?: never } | { href?: never; onSelect: () => void }

const isString = (value: unknown): value is string => typeof value === 'string'

/** Selected hub section: from the URL on web pages, kept in sessionStorage elsewhere (in-game overlay) */
export function useHubSection(route: HubRoute | undefined, storageKey: string): { section: string; navTo: (section: string) => NavTarget } {
  const [stored, setStored] = useViewState(storageKey, '', isString)
  if (route) return { section: route.section, navTo: (section) => ({ href: section ? `${route.base}/${section}` : route.base }) }
  return { section: stored, navTo: (section) => ({ onSelect: () => setStored(section) }) }
}
