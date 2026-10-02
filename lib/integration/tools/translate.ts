import { optBool, optList, optNum, optObj, reqStr } from './args'
import type { ApiInvoke, ToolImpls } from './types'

const MAX_TEXTS = 200

/** `chaya_translate_*`; `invoke` targets the server routes or the in-game translator runtime (same paths). */
export function makeTranslateTools(invoke: ApiInvoke): ToolImpls {
  const translate = (body: Record<string, unknown>, signal: AbortSignal) => invoke({ method: 'POST', path: '/api/translate', body, signal })

  return {
    async chaya_translate_text(args, { signal }) {
      const texts = optList(args, 'texts').filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      if (!texts.length) throw new Error('texts 不能为空')
      if (texts.length > MAX_TEXTS) throw new Error(`一次最多 ${MAX_TEXTS} 段`)
      return translate({ texts, force: optBool(args, 'force') ?? false, persist: optBool(args, 'persist') ?? true }, signal)
    },

    async chaya_translate_extract(_args, { signal }) {
      return invoke({ method: 'POST', path: '/api/extract', signal })
    },

    async chaya_translate_job(args, { signal }) {
      const action = reqStr(args, 'action')
      if (action === 'status') return translate({ mode: 'progress' }, signal)
      if (action === 'start' || action === 'pause') return translate({ mode: 'job', action }, signal)
      throw new Error('action 只能是 start、pause、status')
    },

    async chaya_translate_batch(args, { signal }) {
      return translate({ mode: 'seed', limit: optNum(args, 'limit') }, signal)
    },

    async chaya_translate_engines(args, { signal }) {
      const switches = optObj(args, 'switches')
      const order = Array.isArray(args.order) ? args.order : undefined
      return translate({ mode: 'switches', ...(switches ? { switches } : {}), ...(order ? { order } : {}) }, signal)
    },

    async chaya_translate_play_settings(args, { signal }) {
      const current = await translate({ mode: 'play-settings' }, signal)
      const settings = optObj(args, 'settings')
      if (!settings) return current
      const merged = { ...(current.settings as Record<string, unknown> | undefined), ...settings }
      return translate({ mode: 'play-settings', contentRoot: current.contentRoot, settings: merged }, signal)
    },
  }
}
