import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { makeCatalogTools } from '@/lib/integration/tools/catalog'
import { callAgentGame, resolveAgentGame } from '@/services/runtime/agent-bridge'

import { invokeLocalApi } from './route-invoke'

export { filterCatalog } from '@/lib/integration/tools/catalog'

export const editTools = makeCatalogTools(async (signal, gameId) =>
  gameId
    ? ((await callAgentGame(resolveAgentGame(gameId), 'edit.catalog', {})) as Partial<GameEditCatalog>)
    : invokeLocalApi({ method: 'GET', path: '/api/game-edit/catalog', signal })
)
