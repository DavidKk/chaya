import * as CatalogRoute from '@/app/api/game-edit/catalog/route'
import type { CatalogEntry } from '@/lib/game/game-edit-catalog-types'
import { CATALOG_KINDS } from '@/lib/integration/mcp-catalog'

import { includesText, optNum, optStr, reqStr, type ToolImpls } from './args'
import { invokeRoute } from './route-invoke'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export function filterCatalog(entries: CatalogEntry[], q: string | undefined, limit: number) {
  const needle = q?.toLowerCase()
  const asId = needle && /^\d+$/.test(needle) ? Number(needle) : null
  const matched = needle ? entries.filter((e) => e.id === asId || includesText(e.name, needle) || includesText(e.description, needle)) : entries.filter((e) => e.name)
  return { total: entries.length, matched: matched.length, entries: matched.slice(0, limit) }
}

export const editTools: ToolImpls = {
  async chaya_edit_catalog(args, { signal }) {
    const kind = reqStr(args, 'kind') as (typeof CATALOG_KINDS)[number]
    if (!CATALOG_KINDS.includes(kind)) throw new Error(`kind 只能是：${CATALOG_KINDS.join(', ')}`)
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(optNum(args, 'limit') ?? DEFAULT_LIMIT)))
    const catalog = await invokeRoute(CatalogRoute.GET, { method: 'GET', path: '/api/game-edit/catalog', signal })
    return { kind, ...filterCatalog((catalog[kind] as CatalogEntry[] | undefined) ?? [], optStr(args, 'q'), limit) }
  },
}
