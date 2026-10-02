import { makeCacheTools } from '@/lib/integration/tools/cache'

import { invokeLocalApi } from './route-invoke'

export const cacheTools = makeCacheTools(invokeLocalApi)
