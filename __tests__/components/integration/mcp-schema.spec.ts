import { exampleArgs, parseArgsJson, readToolCallResponse, toolParamRows } from '@/components/integration/mcp/schema'
import type { JsonSchemaObject } from '@/lib/integration/mcp-catalog'

const schema: JsonSchemaObject = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['items', 'actors'], description: '类型' },
    q: { type: 'string', description: '关键词' },
    limit: { type: 'number', default: 50 },
    ids: { type: 'array', items: { type: 'number' } },
  },
  required: ['kind', 'limit'],
}

describe('integration MCP schema helpers', () => {
  it('derives param rows', () => {
    expect(toolParamRows(schema)).toEqual([
      { name: 'kind', type: 'string', required: true, description: '类型', enumValues: ['items', 'actors'] },
      { name: 'q', type: 'string', required: false, description: '关键词' },
      { name: 'limit', type: 'number', required: true, description: '' },
      { name: 'ids', type: 'number[]', required: false, description: '' },
    ])
  })

  it('fills example args for required params only', () => {
    expect(exampleArgs(schema)).toEqual({ kind: 'items', limit: 50 })
    expect(exampleArgs({ type: 'object', properties: {} })).toEqual({})
  })

  it('parses only JSON objects', () => {
    expect(parseArgsJson('')).toEqual({})
    expect(parseArgsJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseArgsJson('[1]')).toBeNull()
    expect(parseArgsJson('{bad')).toBeNull()
  })

  it('reads tools/call responses', () => {
    expect(readToolCallResponse({ result: { isError: false, content: [{ type: 'text', text: '{"ok":1}' }] } })).toEqual({ isError: false, text: '{"ok":1}' })
    expect(readToolCallResponse({ result: { isError: true, content: [{ type: 'text', text: '炸了' }] } })).toEqual({ isError: true, text: '炸了' })
    expect(readToolCallResponse({ error: { message: '未知工具' } })).toEqual({ isError: true, text: '未知工具' })
  })
})
