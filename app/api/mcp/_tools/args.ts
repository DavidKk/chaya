import type { McpTool } from '@/initializer/mcp'

export type ToolImpls = Record<string, McpTool['run']>

type Args = Record<string, unknown>

export function optStr(args: Args, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function reqStr(args: Args, key: string): string {
  const v = optStr(args, key)
  if (!v) throw new Error(`缺少参数 ${key}`)
  return v
}

export function optNum(args: Args, key: string): number | undefined {
  const v = args[key]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

export function optBool(args: Args, key: string): boolean | undefined {
  const v = args[key]
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return undefined
}

export function optObj(args: Args, key: string): Record<string, unknown> | undefined {
  const v = args[key]
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

export function optList(args: Args, key: string): unknown[] {
  const v = args[key]
  return Array.isArray(v) ? v : []
}

export function includesText(haystack: unknown, needle: string): boolean {
  return typeof haystack === 'string' && haystack.toLowerCase().includes(needle)
}
