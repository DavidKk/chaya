/**
 * Plugin-MCP tools that run inside the game process (Edge-opened games): live comes from `makeLiveTools`,
 * the rest reuse the shared factories over in-game globals, the same way Edge does over the DataChannel.
 */

import { readApiErrorMessage } from '@/lib/api-error'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { optNum, optStr } from '@/lib/integration/tools/args'
import { makeCacheTools } from '@/lib/integration/tools/cache'
import { makeCatalogTools } from '@/lib/integration/tools/catalog'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets, type ToolImpls } from '@/lib/integration/tools/types'
import { filterLogEntries, normalizeLogLevel } from '@/lib/log'
import { installedTranslationRuntime } from '@/lib/translate/runtime-api'

type PluginLogEntry = { id: number | string; ts: number; level: string; source: string; message: string; meta?: unknown }
type GameLogApi = { history: () => PluginLogEntry[]; clear: () => void }

function gameLog(): GameLogApi {
  const api = (window as Window & { ChayaLog?: Partial<GameLogApi> }).ChayaLog
  if (typeof api?.history !== 'function' || typeof api.clear !== 'function') throw new Error('游戏内日志未就绪')
  return api as GameLogApi
}

/** Translator-runtime invoke: same API paths as the local service, executed in this game */
const runtimeInvoke: ApiInvoke = async ({ method, path, query, body, signal }) => {
  const runtime = installedTranslationRuntime()
  if (!runtime) throw new Error('翻译运行时未就绪：请确认已安装翻译插件，并进入游戏后再试')
  const res = await runtime.request({ path: pathWithQuery(path, query), method, body: body as Record<string, unknown> | undefined }, signal)
  if (res.status >= 400 || res.data?.ok === false) throw new Error(readApiErrorMessage(res.data, `${method} ${path} 失败`))
  const { ok: _ok, ...rest } = res.data
  return redactSecrets(rest)
}

async function loadCatalog(): Promise<GameEditCatalog> {
  const edit = (window as Window & { ChayaEdit?: { catalog?: () => GameEditCatalog } }).ChayaEdit
  if (typeof edit?.catalog !== 'function') throw new Error('修改插件未就绪：请确认已安装修改插件，并读档进入游戏后再试')
  return edit.catalog()
}

const logsTools: ToolImpls = {
  async chaya_logs_query(args) {
    const level = optStr(args, 'level')
    const rows = gameLog()
      .history()
      .map((entry) => ({ ...entry, id: String(entry.id), level: normalizeLogLevel(entry.level) }))
    const entries = filterLogEntries(rows, {
      q: optStr(args, 'q'),
      source: optStr(args, 'source'),
      level: level ? normalizeLogLevel(level) : undefined,
      since: optNum(args, 'since'),
      limit: Math.min(1000, Math.max(1, optNum(args, 'limit') ?? 100)),
    })
    return { count: entries.length, entries }
  },
  async chaya_logs_clear() {
    gameLog().clear()
    return { cleared: true }
  },
}

export function makeGameTools(): ToolImpls {
  const { chaya_translate_batch: _batch, ...translate } = makeTranslateTools(runtimeInvoke)
  return { ...translate, ...makeCacheTools(runtimeInvoke), ...makeCatalogTools(loadCatalog), ...logsTools }
}
