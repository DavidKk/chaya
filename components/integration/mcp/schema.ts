import type { JsonSchema, JsonSchemaObject } from '@/lib/integration/mcp-catalog'

export type ToolParamRow = { name: string; type: string; required: boolean; description: string; enumValues?: readonly (string | number)[] }

function typeLabel(schema: JsonSchema): string {
  if (schema.type === 'array') return `${schema.items ? typeLabel(schema.items) : 'any'}[]`
  return schema.type || 'any'
}

export function toolParamRows(schema: JsonSchemaObject): ToolParamRow[] {
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop),
    required: required.has(name),
    description: prop.description ?? '',
    ...(prop.enum ? { enumValues: prop.enum } : {}),
  }))
}

function placeholder(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  switch (schema.type) {
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
      return {}
    default:
      return ''
  }
}

/** Playground starter args: required params with placeholders */
export function exampleArgs(schema: JsonSchemaObject): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of schema.required ?? []) {
    const prop = schema.properties[name]
    if (prop) out[name] = placeholder(prop)
  }
  return out
}

export function parseArgsJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {}
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export type ToolCallOutcome = { isError: boolean; text: string }

/** JSON-RPC `tools/call` response → display text; pretty-prints JSON payloads */
export function readToolCallResponse(rpc: unknown): ToolCallOutcome {
  const body = (rpc ?? {}) as { error?: { message?: string }; result?: { isError?: boolean; content?: { type?: string; text?: string }[] } }
  if (body.error) return { isError: true, text: body.error.message || 'JSON-RPC error' }
  const text = (body.result?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
  return { isError: Boolean(body.result?.isError), text }
}
