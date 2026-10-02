import { makeCatalogTools } from '@/lib/integration/tools/catalog'

import { invokeLocalApi } from './route-invoke'

export { filterCatalog } from '@/lib/integration/tools/catalog'

export const editTools = makeCatalogTools((signal) => invokeLocalApi({ method: 'GET', path: '/api/game-edit/catalog', signal }))
