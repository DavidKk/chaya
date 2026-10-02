import { webMcpError, type WebMcpErrResult } from '@/initializer/webmcp/result'

import {
  collapseText,
  dialogName,
  findElementByRef,
  hasOpenConfirmDialog,
  isElementDisabled,
  isElementVisible,
  isInConfirmDialog,
  isSensitiveField,
  listOpenDialogs,
  relativeAppPath,
} from './elements'

export const PRESSABLE_KEYS = ['Enter', 'Escape', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'] as const
export type PressableKey = (typeof PRESSABLE_KEYS)[number]

export const WAIT_DEFAULT_TIMEOUT_MS = 5000
export const WAIT_MAX_TIMEOUT_MS = 30000
const WAIT_POLL_MS = 100
const OPTION_WAIT_MS = 1000

type ActionTarget = { ok: true; element: HTMLElement } | WebMcpErrResult

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
export const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

export function currentAppUrl(): string {
  return relativeAppPath(window.location.href) ?? window.location.href
}

export const CONFIRM_REQUIRED = webMcpError('needs_user_confirmation', '确认框需要用户亲自点击确认或取消；请把确认框内容转述给用户')

/** Existing + visible; for writes also enabled and not inside a confirm dialog. */
export function resolveActionTarget(ref: unknown, requireEnabled = true): ActionTarget {
  const found = findElementByRef(ref)
  if (!found.ok) return webMcpError(found.error, found.message)
  if (!isElementVisible(found.element)) return webMcpError('element_hidden', `元素 ${String(ref)} 当前不可见`)
  if (!requireEnabled) return found
  if (isInConfirmDialog(found.element)) return CONFIRM_REQUIRED
  if (isElementDisabled(found.element)) return webMcpError('element_disabled', `元素 ${String(ref)} 已禁用`)
  return found
}

/** Keys other than Escape would settle an open confirm dialog (it listens for Enter globally). */
export function keyBlockedByConfirm(key: PressableKey): boolean {
  return key !== 'Escape' && hasOpenConfirmDialog()
}

export type ActionEffect = { urlChanged: boolean; url: string; dialogsOpened: string[] }

export async function withActionEffect(action: () => void | Promise<void>): Promise<ActionEffect> {
  const beforeUrl = window.location.href
  const beforeDialogs = new Set(listOpenDialogs())
  await action()
  await nextFrame()
  await nextFrame()
  await sleep(150)
  return {
    urlChanged: window.location.href !== beforeUrl,
    url: currentAppUrl(),
    dialogsOpened: listOpenDialogs()
      .filter((dialog) => !beforeDialogs.has(dialog))
      .map(dialogName),
  }
}

function dispatchPointerSequence(element: HTMLElement): void {
  const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }
  const PointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
  element.dispatchEvent(new PointerCtor('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }))
  element.dispatchEvent(new MouseEvent('mousedown', init))
  element.dispatchEvent(new PointerCtor('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }))
  element.dispatchEvent(new MouseEvent('mouseup', init))
}

export function clickElement(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'nearest' })
  element.focus({ preventScroll: true })
  dispatchPointerSequence(element)
  element.click()
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(element, value)
  else element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function optionMatches(text: string, value: string): 'exact' | 'partial' | null {
  const normalizedText = collapseText(text, 500).toLowerCase()
  const normalizedValue = value.trim().toLowerCase()
  if (normalizedText === normalizedValue) return 'exact'
  return normalizedValue && normalizedText.includes(normalizedValue) ? 'partial' : null
}

function pickOption<T>(items: T[], label: (item: T) => string, value: string): T | undefined {
  return items.find((item) => optionMatches(label(item), value) === 'exact') ?? items.find((item) => optionMatches(label(item), value) === 'partial')
}

async function selectCustomOption(trigger: HTMLElement, value: string): Promise<WebMcpErrResult | null> {
  if (trigger.getAttribute('aria-expanded') !== 'true') clickElement(trigger)
  const deadline = Date.now() + OPTION_WAIT_MS
  let options: HTMLElement[] = []
  while (Date.now() < deadline) {
    await nextFrame()
    const controlled = trigger.getAttribute('aria-controls')
    const listbox =
      (controlled ? document.getElementById(controlled) : null) ?? [...document.querySelectorAll<HTMLElement>('[role="listbox"]')].filter(isElementVisible).at(-1) ?? null
    options = listbox ? [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].filter(isElementVisible) : []
    if (options.length) break
  }
  const option = pickOption(options, (item) => item.innerText, value)
  if (!option) {
    const available = options.map((item) => collapseText(item.innerText)).filter(Boolean)
    return webMcpError('option_not_found', available.length ? `没有匹配"${value}"的选项，可选：${available.slice(0, 30).join('、')}` : '下拉没有展开出可选项')
  }
  if (isElementDisabled(option)) return webMcpError('element_disabled', `选项"${collapseText(option.innerText)}"已禁用`)
  clickElement(option)
  return null
}

/** Fill input / textarea / native or custom select / contenteditable. Returns an error or null. */
export async function fillElement(element: HTMLElement, value: string): Promise<WebMcpErrResult | null> {
  if (isSensitiveField(element)) return webMcpError('sensitive_field', '敏感字段不允许由 Agent 填写')
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.readOnly) return webMcpError('element_readonly', '输入框为只读')
    if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(element.type)) {
      return webMcpError('unsupported_element', `type=${element.type} 的输入请用 page_click`)
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    element.focus({ preventScroll: true })
    setNativeValue(element, value)
    return null
  }
  if (element instanceof HTMLSelectElement) {
    const option = [...element.options].find((item) => item.value === value) ?? pickOption([...element.options], (item) => item.text, value)
    if (!option) return webMcpError('option_not_found', `可选：${[...element.options].map((item) => item.text).join('、')}`)
    element.value = option.value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return null
  }
  if (element.getAttribute('role') === 'combobox') return selectCustomOption(element, value)
  if (element.isContentEditable) {
    element.focus()
    element.textContent = value
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
    return null
  }
  return webMcpError('unsupported_element', '该元素不可填写；按钮、链接、复选框请用 page_click')
}

export function pressKey(target: HTMLElement, key: PressableKey): void {
  const keyValue = key === 'Space' ? ' ' : key
  const init = { key: keyValue, code: key === 'Space' ? 'Space' : key, bubbles: true, cancelable: true, composed: true }
  const notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  if (key === 'Enter' && notPrevented && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.form) {
    target.form.requestSubmit()
  }
}

function isScrollable(element: Element): boolean {
  const style = window.getComputedStyle(element)
  return /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
}

function nearestScrollable(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (isScrollable(node)) return node
  }
  return null
}

function largestVisibleScrollable(): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestArea = 0
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    if (!isScrollable(element) || !isElementVisible(element)) continue
    const rect = element.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area > bestArea) {
      best = element
      bestArea = area
    }
  }
  return best
}

export function scrollContainer(anchor: HTMLElement | null, direction: 'up' | 'down', amount: 'page' | 'half'): { target: 'element' | 'window'; scrollTop: number } {
  const container = anchor ? nearestScrollable(anchor) : largestVisibleScrollable()
  const sign = direction === 'up' ? -1 : 1
  if (container) {
    container.scrollBy({ top: sign * container.clientHeight * (amount === 'half' ? 0.5 : 0.9) })
    return { target: 'element', scrollTop: Math.round(container.scrollTop) }
  }
  window.scrollBy({ top: sign * window.innerHeight * (amount === 'half' ? 0.5 : 0.9) })
  return { target: 'window', scrollTop: Math.round(window.scrollY) }
}

/** Poll until `check` holds; resolves elapsed ms, or null on timeout. */
export async function waitUntil(check: () => boolean, timeoutMs: number): Promise<number | null> {
  const started = Date.now()
  while (true) {
    if (check()) return Date.now() - started
    if (Date.now() - started >= timeoutMs) return null
    await sleep(WAIT_POLL_MS)
  }
}
