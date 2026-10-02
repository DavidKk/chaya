import * as CacheRoute from '@/app/api/translate-cache/route'

import { optBool, optNum, optStr, reqStr, type ToolImpls } from './args'
import { invokeRoute } from './route-invoke'

export const cacheTools: ToolImpls = {
  async chaya_cache_query(args, { signal }) {
    return invokeRoute(CacheRoute.GET, {
      method: 'GET',
      path: '/api/translate-cache',
      query: {
        q: optStr(args, 'q'),
        engine: optStr(args, 'engine'),
        nsfw: optBool(args, 'nsfw') ? '1' : undefined,
        sort: optStr(args, 'sort'),
        order: optStr(args, 'order'),
        page: optNum(args, 'page'),
        pageSize: optNum(args, 'pageSize'),
      },
      signal,
    })
  },

  async chaya_cache_update(args, { signal }) {
    const src = typeof args.src === 'string' ? args.src : ''
    if (!src) throw new Error('缺少参数 src')
    return invokeRoute(CacheRoute.PATCH, { method: 'PATCH', path: '/api/translate-cache', body: { src, zh: reqStr(args, 'zh') }, signal })
  },

  async chaya_cache_delete(args, { signal }) {
    const src = typeof args.src === 'string' ? args.src : ''
    if (!src) throw new Error('缺少参数 src')
    return invokeRoute(CacheRoute.DELETE, { method: 'DELETE', path: '/api/translate-cache', body: { src }, signal })
  },

  async chaya_cache_import(args, { signal }) {
    const text = typeof args.text === 'string' ? args.text : ''
    if (!text.trim()) throw new Error('缺少参数 text')
    return invokeRoute(CacheRoute.POST, { method: 'POST', path: '/api/translate-cache', body: { text, overwrite: optBool(args, 'overwrite') ?? false, filename: 'mcp' }, signal })
  },
}
