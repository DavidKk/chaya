/**
 * In-game plugin tool implementations: each first-party plugin registers `run` functions for tools in
 * `PLUGIN_TOOL_CATALOG`; ChayaAgent reports them and runs them for MCP / WebMCP calls.
 */

import type { PluginToolCatalogEntry } from '@/lib/runtime/plugin-tool-catalog'
import { findPluginToolMeta, type PluginToolMeta } from '@/lib/runtime/plugin-tools'

export type PluginToolRun = (input: Record<string, unknown>) => unknown

type ToolRegistry = Record<string, Readonly<Record<string, PluginToolRun>>>

const host = globalThis as typeof globalThis & { __chayaPluginTools?: ToolRegistry }

function registry(): ToolRegistry {
  return (host.__chayaPluginTools ??= {})
}

/** Replace `plugin`'s implementations (HMR re-declares); tools missing from the catalog are dropped. */
export function declarePluginTools<P extends PluginToolCatalogEntry['plugin']>(plugin: P, runs: Record<string, PluginToolRun>): void {
  const kept = Object.entries(runs).filter(([tool]) => findPluginToolMeta(plugin, tool))
  registry()[plugin] = Object.freeze(Object.fromEntries(kept))
}

export function listPluginToolMetas(): PluginToolMeta[] {
  const out: PluginToolMeta[] = []
  for (const [plugin, runs] of Object.entries(registry())) {
    for (const tool of Object.keys(runs)) {
      const meta = findPluginToolMeta(plugin, tool)
      if (meta) out.push(meta)
    }
  }
  return out
}

export function findPluginTool(plugin: string, tool: string): PluginToolRun | undefined {
  if (!findPluginToolMeta(plugin, tool)) return undefined
  const runs = registry()[plugin]
  return runs && Object.prototype.hasOwnProperty.call(runs, tool) ? runs[tool] : undefined
}

export function toolNum(input: Record<string, unknown>, key: string, fallback?: number): number {
  const v = input[key]
  if (v === undefined && fallback !== undefined) return fallback
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`${key} 需为数字`)
  return n
}

export function toolBool(input: Record<string, unknown>, key: string): boolean {
  const v = input[key]
  if (typeof v !== 'boolean') throw new Error(`${key} 需为布尔值`)
  return v
}

export function toolStr(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`缺少参数 ${key}`)
  return v.trim()
}
