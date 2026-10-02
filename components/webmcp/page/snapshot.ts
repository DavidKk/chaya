import {
  collapseText,
  describeElement,
  findElementByRef,
  HIDDEN_TEXT,
  INTERACTIVE_SELECTOR,
  isElementVisible,
  type PageElementSummary,
  resolveScopeRoot,
  SENSITIVE_ATTRIBUTE,
} from './elements'

export const SNAPSHOT_DEFAULT_LIMIT = 150
export const SNAPSHOT_MAX_LIMIT = 500
export const READ_TEXT_DEFAULT_CHARS = 4000
export const READ_TEXT_MAX_CHARS = 20000
const HEADING_LIMIT = 40

export type ScopeResult = { ok: true; root: HTMLElement; scope: 'element' | 'dialog' | 'page' } | { ok: false; error: 'invalid_input' | 'element_not_found'; message: string }

export function resolveToolScope(ref: unknown, fallback: 'page' | 'main' = 'page'): ScopeResult {
  if (ref !== undefined && ref !== null && ref !== '') {
    const found = findElementByRef(ref)
    return found.ok ? { ok: true, root: found.element, scope: 'element' } : found
  }
  const { root, scope } = resolveScopeRoot()
  if (scope === 'page' && fallback === 'main') return { ok: true, root: document.querySelector<HTMLElement>('main') ?? root, scope }
  return { ok: true, root, scope }
}

export function clampInteger(value: unknown, fallback: number, max: number): number {
  const number = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(number) || number < 1) return fallback
  return Math.min(number, max)
}

function matchesQuery(summary: PageElementSummary, query: string): boolean {
  return `${summary.role} ${summary.name} ${summary.value ?? ''} ${summary.href ?? ''}`.toLowerCase().includes(query)
}

export interface PageSnapshot {
  scope: 'element' | 'dialog' | 'page'
  title: string
  headings?: Array<{ level: number; text: string }>
  elements: PageElementSummary[]
  total: number
  truncated: boolean
}

export function buildPageSnapshot(
  root: HTMLElement,
  scope: PageSnapshot['scope'],
  options: { query?: string; role?: string; limit: number; includeHeadings: boolean }
): PageSnapshot {
  const query = options.query?.trim().toLowerCase() ?? ''
  const role = options.role?.trim().toLowerCase() ?? ''
  const candidates = [...(root.matches(INTERACTIVE_SELECTOR) ? [root] : []), ...root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)]
  const matched: PageElementSummary[] = []
  for (const element of candidates) {
    if (!isElementVisible(element)) continue
    const summary = describeElement(element)
    if (role && summary.role !== role) continue
    if (!query || matchesQuery(summary, query)) matched.push(summary)
  }
  const snapshot: PageSnapshot = { scope, title: document.title, elements: matched.slice(0, options.limit), total: matched.length, truncated: matched.length > options.limit }
  if (options.includeHeadings) {
    snapshot.headings = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4')]
      .filter(isElementVisible)
      .slice(0, HEADING_LIMIT)
      .map((heading) => ({ level: Number(heading.tagName.slice(1)), text: collapseText(heading.innerText, 120) }))
      .filter((heading) => heading.text)
  }
  return snapshot
}

/** Shorter leaves are labels ("复制", "Cursor") that also appear elsewhere on the page; secrets are longer. */
const MIN_SECRET_LEAF_CHARS = 12

/** Secret strings inside sensitive regions: the region text plus each long leaf's text (layout may split lines). */
function sensitiveTexts(root: HTMLElement): string[] {
  const secrets = new Set<string>()
  for (const node of root.querySelectorAll<HTMLElement>(`[${SENSITIVE_ATTRIBUTE}]`)) {
    for (const el of [node, ...node.querySelectorAll<HTMLElement>('*')]) {
      if (el !== node && el.children.length) continue
      const text = (el.innerText ?? el.textContent ?? '').trim()
      if (text && (el === node || text.length >= MIN_SECRET_LEAF_CHARS)) secrets.add(text)
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length)
}

export function visibleTextOf(root: HTMLElement): string {
  if (root.closest(`[${SENSITIVE_ATTRIBUTE}]`)) return HIDDEN_TEXT
  let text = root.innerText ?? root.textContent ?? ''
  for (const secret of sensitiveTexts(root)) text = text.split(secret).join(HIDDEN_TEXT)
  return text
}

export function readVisibleText(root: HTMLElement, maxChars: number): { text: string; truncated: boolean; totalChars: number } {
  const text = visibleTextOf(root)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars, totalChars: text.length }
}
