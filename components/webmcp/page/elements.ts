export const PAGE_REF_ATTRIBUTE = 'data-webmcp-ref'
/** Tokens, token-bearing commands / links: hidden from snapshots and text, never filled */
export const SENSITIVE_ATTRIBUTE = 'data-webmcp-sensitive'
/** Confirm dialogs: only the user may settle them */
export const CONFIRM_ATTRIBUTE = 'data-webmcp-confirm'
const REF_PATTERN = /^e\d+$/
const NAME_MAX_CHARS = 80
export const HIDDEN_TEXT = '[已隐藏]'

const INTERACTIVE_ROLES = [
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
]

export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  ...INTERACTIVE_ROLES.map((role) => `[role="${role}"]`),
].join(',')

const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"],dialog[open]'

let refCounter = 0

export function collapseText(value: string | null | undefined, max = NAME_MAX_CHARS): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function ensureElementRef(element: Element): string {
  const existing = element.getAttribute(PAGE_REF_ATTRIBUTE)
  if (existing) return existing
  refCounter += 1
  const ref = `e${refCounter}`
  element.setAttribute(PAGE_REF_ATTRIBUTE, ref)
  return ref
}

export type ElementLookup = { ok: true; element: HTMLElement } | { ok: false; error: 'invalid_input' | 'element_not_found'; message: string }

export function findElementByRef(ref: unknown): ElementLookup {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return { ok: false, error: 'invalid_input', message: 'ref 需为 page_snapshot 返回的编号，如 e12' }
  const element = document.querySelector<HTMLElement>(`[${PAGE_REF_ATTRIBUTE}="${ref}"]`)
  return element ? { ok: true, element } : { ok: false, error: 'element_not_found', message: `元素 ${ref} 已不在页面上，请重新调用 page_snapshot` }
}

export function isElementVisible(element: Element): boolean {
  if (!element.isConnected || element.closest('[aria-hidden="true"],[inert]')) return false
  if (element.getClientRects().length === 0) return false
  const style = window.getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

export function isElementDisabled(element: Element): boolean {
  if ((element as HTMLButtonElement).disabled === true) return true
  return element.closest('[aria-disabled="true"],fieldset[disabled]') !== null
}

export function isInConfirmDialog(element: Element): boolean {
  return element.closest(`[${CONFIRM_ATTRIBUTE}]`) !== null
}

export function hasOpenConfirmDialog(): boolean {
  return [...document.querySelectorAll(`[${CONFIRM_ATTRIBUTE}]`)].some(isElementVisible)
}

export function isSensitiveField(element: Element): boolean {
  if (element.closest(`[${SENSITIVE_ATTRIBUTE}]`)) return true
  if (!(element instanceof HTMLInputElement)) return false
  if (element.type === 'password') return true
  const autocomplete = element.autocomplete.toLowerCase()
  return autocomplete.includes('password') || autocomplete.includes('one-time-code') || autocomplete.includes('cc-')
}

export function elementRole(element: Element): string {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'button' || tag === 'summary') return 'button'
  if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type
    if (type === 'checkbox' || type === 'radio') return type
    if (type === 'range') return 'slider'
    if (type === 'number') return 'spinbutton'
    if (type === 'search') return 'searchbox'
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button'
    return 'textbox'
  }
  if ((element as HTMLElement).isContentEditable) return 'textbox'
  return tag
}

function textOfIds(ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

export function elementName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel?.trim()) return collapseText(ariaLabel)
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = collapseText(textOfIds(labelledBy))
    if (text) return text
  }
  const labels = (element as HTMLInputElement).labels
  if (labels?.length) {
    const text = collapseText([...labels].map((label) => label.textContent).join(' '))
    if (text) return text
  }
  const placeholder = element.getAttribute('placeholder')
  if (placeholder?.trim()) return collapseText(placeholder)
  const title = element.getAttribute('title')
  if (title?.trim()) return collapseText(title)
  if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) return collapseText(element.value)
  const text = collapseText((element as HTMLElement).innerText ?? element.textContent)
  if (text) return text
  return collapseText(element.querySelector('img[alt]')?.getAttribute('alt'))
}

export function elementValue(element: Element): string | null {
  if (isSensitiveField(element)) return null
  if (element instanceof HTMLSelectElement) return collapseText([...element.selectedOptions].map((option) => option.text).join(', '))
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return null
    return element.value
  }
  if (element instanceof HTMLTextAreaElement) return element.value
  if ((element as HTMLElement).isContentEditable) return collapseText((element as HTMLElement).innerText, 500)
  return null
}

function ariaBoolean(element: Element, attribute: string): boolean | undefined {
  const value = element.getAttribute(attribute)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export interface PageElementSummary {
  ref: string
  role: string
  name: string
  value?: string | null
  sensitive?: true
  confirm?: true
  disabled?: true
  readonly?: true
  checked?: boolean
  expanded?: boolean
  selected?: boolean
  pressed?: boolean
  href?: string
}

export function relativeAppPath(href: string): string | null {
  try {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function describeElement(element: HTMLElement): PageElementSummary {
  const sensitive = isSensitiveField(element)
  const summary: PageElementSummary = {
    ref: ensureElementRef(element),
    role: elementRole(element),
    name: sensitive && element.closest(`[${SENSITIVE_ATTRIBUTE}]`) ? HIDDEN_TEXT : elementName(element),
  }
  if (sensitive) {
    summary.value = null
    summary.sensitive = true
  } else {
    const value = elementValue(element)
    if (value !== null) summary.value = value
  }
  if (isInConfirmDialog(element)) summary.confirm = true
  if (isElementDisabled(element)) summary.disabled = true
  if ((element as HTMLInputElement).readOnly === true) summary.readonly = true
  const checked = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio') ? element.checked : ariaBoolean(element, 'aria-checked')
  if (checked !== undefined) summary.checked = checked
  const expanded = ariaBoolean(element, 'aria-expanded')
  if (expanded !== undefined) summary.expanded = expanded
  const selected = ariaBoolean(element, 'aria-selected')
  if (selected !== undefined) summary.selected = selected
  const pressed = ariaBoolean(element, 'aria-pressed')
  if (pressed !== undefined) summary.pressed = pressed
  if (!sensitive && element instanceof HTMLAnchorElement && element.getAttribute('href')) {
    summary.href = relativeAppPath(element.href) ?? element.href
  }
  return summary
}

export function listOpenDialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(MODAL_DIALOG_SELECTOR)].filter(isElementVisible)
}

export function dialogName(dialog: HTMLElement): string {
  const labelledBy = dialog.getAttribute('aria-labelledby')
  return (
    collapseText(dialog.getAttribute('aria-label')) ||
    (labelledBy ? collapseText(textOfIds(labelledBy)) : '') ||
    collapseText(dialog.querySelector('h1,h2,h3,h4')?.textContent) ||
    '对话框'
  )
}

/** Topmost visible modal dialog, else the whole page. */
export function resolveScopeRoot(): { root: HTMLElement; scope: 'dialog' | 'page' } {
  const top = listOpenDialogs().at(-1)
  return top ? { root: top, scope: 'dialog' } : { root: document.body, scope: 'page' }
}
