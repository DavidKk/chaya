import { isSourceText } from '@/lib/translate/source-text'

const JAPANESE = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F\u4E00-\u9FFF]/

export function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export function isUseful(text: unknown): boolean {
  return isSourceText(typeof text === 'string' ? clean(text) : text)
}

export function addUnique(bucket: string[], set: Set<string>, text: unknown): boolean {
  const s = clean(text)
  if (!isUseful(s)) return false
  if (set.has(s)) return false
  set.add(s)
  bucket.push(s)
  return true
}

export { JAPANESE }
