/**
 * Item / actor display names: include ChayaTrans translation when available.
 */

export type ItemLabel = { name: string; zh: string }

export function tName(name: unknown): string {
  if (!name) return ''
  const translate = window.ChayaTrans?.translate ?? window._chayaTranslate
  if (translate) {
    const zh = translate(String(name))
    if (zh && zh !== name) return zh
  }
  return String(name)
}

/** Display name: empty name → first description line or #id so items still show */
export function itemLabel(row: { id?: number; name?: string; description?: string } | null | undefined): ItemLabel {
  if (!row) return { name: '', zh: '' }
  const raw = String(row.name || '')
  if (raw) {
    const zh = tName(raw)
    return { name: raw, zh: zh !== raw ? zh : '' }
  }
  const desc = String(row.description || '')
    .replace(/\\[A-Za-z]+(?:\[\d+\])?/g, '')
    .split(/\r?\n|\\n/)[0]
    .trim()
  if (desc) {
    const short = desc.slice(0, 48)
    const zh = tName(short)
    return { name: short, zh: zh !== short ? zh : '' }
  }
  return { name: `#${row.id}`, zh: '' }
}
