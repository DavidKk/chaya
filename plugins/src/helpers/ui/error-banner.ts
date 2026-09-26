/**
 * In-game visible error panel: accumulates, does not auto-dismiss; no React.
 * History on window.__chayaErrorLog + sessionStorage; guardian remounts if the game clears DOM.
 */

import { clearElement } from './dom'

const HOST_ID = 'chaya-error-banner'
const STORAGE_KEY = 'chaya-error-log-v1'
const MAX_ENTRIES = 30
const GUARDIAN_MS = 250

type ErrorEntry = {
  id: number
  at: number
  title: string
  detail: string
}

type ErrorStore = {
  seq: number
  entries: ErrorEntry[]
}

function loadPersisted(): ErrorStore | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ErrorStore>
    if (!parsed || !Array.isArray(parsed.entries)) return null
    return {
      seq: typeof parsed.seq === 'number' ? parsed.seq : parsed.entries.length,
      entries: parsed.entries.filter((e) => e && typeof e.id === 'number' && typeof e.title === 'string'),
    }
  } catch {
    return null
  }
}

function persist(s: ErrorStore) {
  try {
    if (!s.entries.length) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ seq: s.seq, entries: s.entries }))
  } catch {
    /* quota / private mode */
  }
}

function store(): ErrorStore {
  const w = window as Window & { __chayaErrorLog?: ErrorStore }
  if (!w.__chayaErrorLog) {
    w.__chayaErrorLog = loadPersisted() || { seq: 0, entries: [] }
  }
  return w.__chayaErrorLog
}

function commit(s: ErrorStore) {
  persist(s)
}

function formatErr(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack.split('\n').slice(0, 6).join('\n')}` : ''
    return `${err.name}: ${err.message}${stack}`
  }
  try {
    return JSON.stringify(err, null, 2)
  } catch {
    return String(err)
  }
}

function timeLabel(ts: number): string {
  try {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  } catch {
    return ''
  }
}

function paint(host: HTMLElement) {
  const { entries } = store()
  if (!entries.length) {
    host.style.display = 'none'
    clearElement(host)
    return
  }
  clearElement(host)

  const head = document.createElement('div')
  Object.assign(head.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '8px',
    fontWeight: '700',
    fontSize: '13px',
  } as CSSStyleDeclaration)
  const title = document.createElement('div')
  title.textContent = `Chaya 错误（${entries.length}）— 点清除才关闭`
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.textContent = '全部清除'
  Object.assign(clearBtn.style, {
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'transparent',
    color: '#fff',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  } as CSSStyleDeclaration)
  clearBtn.addEventListener('click', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const s = store()
    s.entries = []
    commit(s)
    host.style.display = 'none'
    clearElement(host)
  })
  head.appendChild(title)
  head.appendChild(clearBtn)
  host.appendChild(head)

  const list = document.createElement('div')
  Object.assign(list.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '42vh',
    overflow: 'auto',
  } as CSSStyleDeclaration)

  for (const entry of [...entries].reverse()) {
    const card = document.createElement('div')
    Object.assign(card.style, {
      border: '1px solid rgba(252,165,165,0.45)',
      borderRadius: '6px',
      padding: '8px 10px',
      background: 'rgba(0,0,0,0.22)',
    } as CSSStyleDeclaration)

    const row = document.createElement('div')
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: entry.detail ? '4px' : '0',
    } as CSSStyleDeclaration)

    const label = document.createElement('div')
    label.textContent = `[${timeLabel(entry.at)}] ${entry.title}`
    Object.assign(label.style, { fontWeight: '600', flex: '1' } as CSSStyleDeclaration)

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = '×'
    dismiss.title = '关闭本条'
    Object.assign(dismiss.style, {
      border: 'none',
      background: 'transparent',
      color: '#fecaca',
      cursor: 'pointer',
      fontSize: '16px',
      lineHeight: '1',
      padding: '0 2px',
    } as CSSStyleDeclaration)
    dismiss.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const s = store()
      s.entries = s.entries.filter((e) => e.id !== entry.id)
      commit(s)
      paint(host)
    })

    row.append(label, dismiss)
    card.appendChild(row)

    if (entry.detail) {
      const body = document.createElement('pre')
      body.textContent = entry.detail
      Object.assign(body.style, {
        margin: '0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        fontSize: '11px',
        opacity: '0.95',
      } as CSSStyleDeclaration)
      card.appendChild(body)
    }

    list.appendChild(card)
  }

  host.appendChild(list)
  host.style.display = 'block'
}

function ensureHost(): HTMLElement {
  let host = document.getElementById(HOST_ID)
  if (host?.isConnected) return host
  if (host && !host.isConnected) {
    try {
      host.remove()
    } catch {
      /* */
    }
  }
  host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('role', 'alert')
  Object.assign(host.style, {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: '12px',
    zIndex: '2147483646',
    maxWidth: '760px',
    margin: '0 auto',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #fca5a5',
    background: 'rgba(127, 29, 29, 0.96)',
    color: '#fff',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.45',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    display: 'none',
    pointerEvents: 'auto',
  } as CSSStyleDeclaration)
  // Attach under <html> to survive game clearing <body>
  const root = document.documentElement
  if (root) root.appendChild(host)
  else document.body.appendChild(host)
  return host
}

function reattachIfNeeded() {
  if (!store().entries.length) return
  try {
    const host = document.getElementById(HOST_ID)
    if (!host || !host.isConnected || host.style.display === 'none') {
      paint(ensureHost())
    }
  } catch {
    /* */
  }
}

function ensureGuardian() {
  const w = window as Window & { __chayaErrorGuardian?: number; __chayaErrorObserver?: MutationObserver }
  if (!w.__chayaErrorGuardian) {
    w.__chayaErrorGuardian = window.setInterval(reattachIfNeeded, GUARDIAN_MS) as unknown as number
  }
  if (!w.__chayaErrorObserver && typeof MutationObserver !== 'undefined') {
    try {
      const obs = new MutationObserver(() => reattachIfNeeded())
      obs.observe(document.documentElement, { childList: true, subtree: true })
      w.__chayaErrorObserver = obs
    } catch {
      /* */
    }
  }
}

/** Remount the panel if historical errors exist */
export function restorePluginErrors() {
  // If window was wiped, restore from sessionStorage
  const w = window as Window & { __chayaErrorLog?: ErrorStore }
  if (!w.__chayaErrorLog?.entries?.length) {
    const persisted = loadPersisted()
    if (persisted?.entries.length) w.__chayaErrorLog = persisted
  }
  ensureGuardian()
  if (!store().entries.length) return
  try {
    paint(ensureHost())
  } catch {
    /* */
  }
}

/** Append one error and show; no auto-dismiss — close via × / Clear all */
export function showPluginError(title: string, err?: unknown) {
  const detail = formatErr(err)
  const text = detail ? `${title}\n${detail}` : title
  try {
    console.error('[Chaya]', text)
  } catch {
    /* */
  }

  const s = store()
  s.seq += 1
  s.entries.push({
    id: s.seq,
    at: Date.now(),
    title: String(title || '错误'),
    detail,
  })
  if (s.entries.length > MAX_ENTRIES) {
    s.entries.splice(0, s.entries.length - MAX_ENTRIES)
  }
  commit(s)

  ensureGuardian()
  try {
    paint(ensureHost())
  } catch {
    try {
      window.alert(text)
    } catch {
      /* */
    }
  }

  // Survive Scene_Boot / Graphics clearing DOM: force remount shortly after
  for (const ms of [400, 800, 2000, 4000, 8000]) {
    window.setTimeout(() => restorePluginErrors(), ms)
  }
}

/** Debug: return current accumulated errors */
export function getPluginErrors(): ErrorEntry[] {
  return [...store().entries]
}
