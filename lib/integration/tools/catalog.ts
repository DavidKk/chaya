import type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { CATALOG_KINDS } from '@/lib/integration/mcp-catalog'

import { includesText, optNum, optStr, reqStr } from './args'
import type { ToolImpls } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export function filterCatalog(entries: CatalogEntry[], q: string | undefined, limit: number) {
  const needle = q?.toLowerCase()
  const asId = needle && /^\d+$/.test(needle) ? Number(needle) : null
  const matched = needle ? entries.filter((e) => e.id === asId || includesText(e.name, needle) || includesText(e.description, needle)) : entries.filter((e) => e.name)
  return { total: entries.length, matched: matched.length, entries: matched.slice(0, limit) }
}

/** `chaya_edit_catalog`; the catalog comes from the server route / bridge or from the game over the DataChannel. */
export function makeCatalogTools(load: (signal: AbortSignal, gameId?: string) => Promise<Partial<GameEditCatalog> | Record<string, unknown>>): ToolImpls {
  return {
    async chaya_edit_catalog(args, { signal }) {
      const kind = reqStr(args, 'kind') as (typeof CATALOG_KINDS)[number]
      if (!CATALOG_KINDS.includes(kind)) throw new Error(`kind 只能是：${CATALOG_KINDS.join(', ')}`)
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(optNum(args, 'limit') ?? DEFAULT_LIMIT)))
      const catalog = (await load(signal, optStr(args, 'gameId'))) as Record<string, unknown>
      return { kind, ...filterCatalog((catalog[kind] as CatalogEntry[] | undefined) ?? [], optStr(args, 'q'), limit) }
    },
  }
}
