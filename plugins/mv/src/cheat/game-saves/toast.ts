/**
 * 存档 / 读档的游戏内提示：外观与实时翻译状态提示一致（右下角圆形图标展开为文字）。
 * 翻译提示由另一个插件包渲染，这里只通过它的 DOM 元素避让，叠在它上方。
 */

export type SaveToastKind = 'pending' | 'success' | 'failure'

const HOST_ID = 'chaya-save-status'
const TRANSLATION_ID = 'chaya-translation-status'
const STAGE_MS = 180
const MIN_PENDING_MS = 400
const HIDE_MS: Record<Exclude<SaveToastKind, 'pending'>, number> = { success: 2000, failure: 4000 }

const CSS = `
  #${HOST_ID} { position: fixed; z-index: 10; right: 12px; bottom: var(--chaya-save-offset, 12px); width: 28px; height: 28px; border-radius: 999px;
    display: flex; align-items: center; gap: 6px; padding: 6px; pointer-events: none; opacity: 0; transform: scale(.65);
    transition: width 180ms ease, opacity 180ms ease, transform 180ms ease, bottom 180ms ease, top 180ms ease;
    box-sizing: border-box; overflow: hidden; white-space: nowrap; background: rgba(0, 0, 0, .76); color: #55b9ef; }
  #${HOST_ID}[data-corner="top"] { top: var(--chaya-save-offset, 12px); bottom: auto; }
  #${HOST_ID}[data-phase="icon"], #${HOST_ID}[data-phase="expanded"] { opacity: 1; transform: scale(1); }
  #${HOST_ID}[data-phase="expanded"] { width: var(--chaya-save-width); }
  #${HOST_ID}[data-kind="success"] { color: #6cdda7; }
  #${HOST_ID}[data-kind="failure"] { color: #ef8c84; }
  #${HOST_ID} .chaya-save-ring { width: 16px; height: 16px; flex: none; border: 2px solid currentColor; border-radius: 50%;
    display: grid; place-items: center; box-sizing: border-box; }
  #${HOST_ID}[data-kind="pending"] .chaya-save-ring { border-right-color: transparent; animation: chaya-save-spin 840ms linear infinite; }
  #${HOST_ID} .chaya-save-mark { font: 700 11px/1 sans-serif; }
  #${HOST_ID} .chaya-save-label { flex: none; opacity: 0; color: #fff; font: 700 12px/16px sans-serif; transition: opacity 100ms ease; }
  #${HOST_ID}[data-phase="expanded"] .chaya-save-label { opacity: 1; transition-delay: 160ms; }
  @keyframes chaya-save-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { #${HOST_ID}, #${HOST_ID} .chaya-save-label { transition-duration: 1ms; }
    #${HOST_ID} .chaya-save-ring { animation-duration: 2s !important; } }
`

let host: HTMLElement | null = null
let style: HTMLStyleElement | null = null
let generation = 0
let shownAt = 0
let timers: ReturnType<typeof setTimeout>[] = []
let pointer: { x: number; y: number } | null = null

function clearTimers() {
  for (const t of timers) clearTimeout(t)
  timers = []
}

function later(fn: () => void, ms: number) {
  timers.push(setTimeout(fn, ms))
}

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY }
  place()
}

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host
  style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('role', 'status')
  host.innerHTML = '<span class="chaya-save-ring"><span class="chaya-save-mark"></span></span><span class="chaya-save-label"></span>'
  host.dataset.phase = 'hidden'
  document.body.appendChild(host)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  return host
}

/** 与翻译提示同角落：翻译提示可见时叠在它上方，指针靠近右下角时一起移到顶部 */
function place() {
  if (!host) return
  const translation = document.getElementById(TRANSLATION_ID)
  const translationVisible = !!translation && translation.dataset.phase !== 'hidden' && translation.dataset.phase !== undefined
  const nearBottomRight = !!pointer && pointer.x > window.innerWidth - 76 && pointer.y > window.innerHeight - 87
  const corner = translation?.dataset.corner === 'top' || nearBottomRight ? 'top' : 'bottom'
  host.dataset.corner = corner
  host.style.setProperty('--chaya-save-offset', `${translationVisible ? 48 : 12}px`)
}

function render(kind: SaveToastKind, label: string) {
  const node = ensureHost()
  node.dataset.kind = kind
  node.setAttribute('aria-label', label)
  node.style.setProperty('--chaya-save-width', `${28 + 6 + label.length * 12}px`)
  node.querySelector('.chaya-save-mark')!.textContent = kind === 'success' ? '✓' : kind === 'failure' ? '×' : ''
  node.querySelector('.chaya-save-label')!.textContent = label
}

function hide(gen: number) {
  if (!host || gen !== generation) return
  host.dataset.phase = 'icon'
  later(() => {
    if (host && gen === generation) host.dataset.phase = 'hidden'
  }, STAGE_MS)
}

/** 显示「存档中」等进行中提示 */
export function showSaveToastPending(label: string): void {
  clearTimers()
  const gen = ++generation
  render('pending', label)
  place()
  shownAt = Date.now()
  const node = host!
  if (node.dataset.phase === 'expanded') return
  node.dataset.phase = 'hidden'
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (gen !== generation) return
      node.dataset.phase = 'icon'
      later(() => {
        if (gen === generation) node.dataset.phase = 'expanded'
      }, STAGE_MS)
    })
  )
}

/** 结果提示；进行中提示至少停留 400ms 再切换，避免一闪而过 */
export function showSaveToastResult(kind: Exclude<SaveToastKind, 'pending'>, label: string): void {
  const wait = host?.dataset.kind === 'pending' && host.dataset.phase !== 'hidden' ? Math.max(0, MIN_PENDING_MS - (Date.now() - shownAt)) : 0
  const apply = () => {
    clearTimers()
    const gen = ++generation
    render(kind, label)
    place()
    const node = host!
    if (node.dataset.phase !== 'expanded') {
      node.dataset.phase = 'icon'
      later(() => {
        if (gen === generation) node.dataset.phase = 'expanded'
      }, STAGE_MS)
    }
    later(() => hide(gen), HIDE_MS[kind])
  }
  if (wait) later(apply, wait)
  else apply()
}

export function disposeSaveToast(): void {
  clearTimers()
  generation++
  window.removeEventListener('pointermove', onPointerMove)
  host?.remove()
  style?.remove()
  host = null
  style = null
}
