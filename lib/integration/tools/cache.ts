import { optBool, optNum, optStr, reqStr } from './args'
import type { ApiInvoke, ToolImpls } from './types'

const PATH = '/api/translate-cache'

function requireSrc(args: Record<string, unknown>): string {
  const src = typeof args.src === 'string' ? args.src : ''
  if (!src) throw new Error('缺少参数 src')
  return src
}

/** `chaya_cache_*`; same paths on the server route and the in-game translator runtime. */
export function makeCacheTools(invoke: ApiInvoke): ToolImpls {
  return {
    async chaya_cache_query(args, { signal }) {
      return invoke({
        method: 'GET',
        path: PATH,
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
      return invoke({ method: 'PATCH', path: PATH, body: { src: requireSrc(args), zh: reqStr(args, 'zh') }, signal })
    },

    async chaya_cache_delete(args, { signal }) {
      return invoke({ method: 'DELETE', path: PATH, body: { src: requireSrc(args) }, signal })
    },

    async chaya_cache_import(args, { signal }) {
      const text = typeof args.text === 'string' ? args.text : ''
      if (!text.trim()) throw new Error('缺少参数 text')
      return invoke({ method: 'POST', path: PATH, body: { text, overwrite: optBool(args, 'overwrite') ?? false, filename: 'mcp' }, signal })
    },
  }
}
