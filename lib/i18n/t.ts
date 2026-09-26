import type { MessageTree } from '@/lib/i18n/messages/types'

type NestedKeyOf<T, P extends string = ''> = T extends string
  ? P
  : {
      [K in keyof T & string]: NestedKeyOf<T[K], P extends '' ? K : `${P}.${K}`>
    }[keyof T & string]

export type MessageKey = NestedKeyOf<MessageTree>

export type MessageParams = Record<string, string | number>

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.')
  let cur: unknown = tree
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value == null ? `{${name}}` : String(value)
  })
}

export function translate(tree: MessageTree, key: MessageKey, params?: MessageParams): string {
  const raw = lookup(tree, key)
  if (raw == null) return key
  return formatMessage(raw, params)
}
