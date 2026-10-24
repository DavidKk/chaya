/** Remote play confirmation and unstarted-control cancellation for T6 host starts. */

import { authorizationCopy } from './authorization-copy'

export function controlStartCancelled(message: string) {
  return Object.assign(new Error(message), { code: 'CANCELLED' as const, retryable: false })
}

export type ControlStartHandle = {
  signal: AbortSignal
  epoch: number
  release(): void
}

export function assertControlStartLive(handle?: ControlStartHandle | AbortSignal, deadlineAt?: number, epoch?: number) {
  const signal = handle && 'signal' in handle ? handle.signal : handle
  const started = handle && 'epoch' in handle ? handle.epoch : undefined
  if (signal?.aborted) throw signal.reason ?? controlStartCancelled('控制请求已取消')
  if (typeof started === 'number' && typeof epoch === 'number' && started !== epoch) {
    throw controlStartCancelled('控制请求已失效')
  }
  if (typeof deadlineAt === 'number' && Date.now() > deadlineAt) throw controlStartCancelled('控制请求已过期')
}

export function createCompanionControlGate() {
  let authorized = false
  let epoch = 1
  let closeDialog: (() => void) | null = null
  const waiters = new Set<(error?: unknown) => void>()
  const pendingStarts = new Set<AbortController>()

  const finishDialog = (error?: Error) => {
    const close = closeDialog
    closeDialog = null
    close?.()
    if (!error) authorized = true
    const pending = [...waiters]
    waiters.clear()
    for (const settle of pending) settle(error)
  }

  const openDialog = () => {
    const copy = authorizationCopy()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', copy.aria)
    dialog.style.cssText =
      'max-width:28rem;border:1px solid var(--line,#4b5563);border-radius:6px;background:var(--panel,#17191d);color:var(--ink,#f5f5f5);padding:20px;box-shadow:0 20px 60px rgb(0 0 0 / .55)'
    const title = document.createElement('h2')
    title.textContent = copy.title
    title.style.cssText = 'margin:0 0 8px;font-size:16px'
    const description = document.createElement('p')
    description.textContent = copy.description
    description.style.cssText = 'margin:0 0 16px;font-size:13px;line-height:1.6;color:var(--ink-soft,#b5bac3)'
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px'
    const deny = document.createElement('button')
    deny.type = 'button'
    deny.textContent = copy.deny
    const allow = document.createElement('button')
    allow.type = 'button'
    allow.textContent = copy.allow
    for (const button of [deny, allow]) {
      button.style.cssText = 'min-width:72px;height:34px;border:1px solid var(--line,#4b5563);border-radius:4px;background:var(--paper-2,#25282e);color:inherit;cursor:pointer'
    }
    allow.style.background = 'var(--accent,#22c55e)'
    allow.style.color = '#fff'
    actions.append(deny, allow)
    dialog.append(title, description, actions)
    document.body.append(dialog)
    deny.addEventListener('click', () => finishDialog(new Error('玩家未允许网页控制 Agent')))
    allow.addEventListener('click', () => finishDialog())
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finishDialog(new Error('玩家取消了 Agent 控制确认'))
    })
    closeDialog = () => {
      dialog.close()
      dialog.remove()
    }
    dialog.showModal()
  }

  const authorize = (deadlineAt: number, handle?: ControlStartHandle) => {
    assertControlStartLive(handle, deadlineAt, epoch)
    if (authorized) return Promise.resolve()
    const signal = handle?.signal
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: unknown) => {
        if (settled) return
        settled = true
        waiters.delete(settle)
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => {
        settle(signal?.reason ?? controlStartCancelled('控制请求已取消'))
        // Drop only this waiter. Close the shared dialog when nobody still owns it.
        if (!waiters.size && closeDialog) finishDialog(controlStartCancelled('控制确认已取消'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      waiters.add(settle)
      if (!closeDialog) openDialog()
    })
  }

  return {
    get epoch() {
      return epoch
    },
    authorize,
    trackStart(outer?: AbortSignal, deadlineAt?: number): ControlStartHandle {
      const local = new AbortController()
      const startedEpoch = epoch
      const forward = () => {
        if (!local.signal.aborted) local.abort(outer?.reason ?? controlStartCancelled('控制请求已取消'))
      }
      const expire = () => {
        if (!local.signal.aborted) local.abort(controlStartCancelled('控制请求已过期'))
      }
      if (outer?.aborted) forward()
      else outer?.addEventListener('abort', forward, { once: true })
      const remain = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : undefined
      const timer = remain === undefined ? 0 : window.setTimeout(expire, Math.max(0, remain))
      pendingStarts.add(local)
      return {
        signal: local.signal,
        epoch: startedEpoch,
        release() {
          pendingStarts.delete(local)
          if (timer) window.clearTimeout(timer)
          outer?.removeEventListener('abort', forward)
        },
      }
    },
    abortPending(reason: unknown) {
      epoch += 1
      const error = reason instanceof Error ? reason : controlStartCancelled(String(reason))
      for (const item of [...pendingStarts]) item.abort(error)
    },
    cancelDialog: () => finishDialog(new Error('网页连接已断开')),
    dispose() {
      this.abortPending(controlStartCancelled('网页连接已断开'))
      if (closeDialog) finishDialog(new Error('网页连接已断开'))
    },
  }
}
