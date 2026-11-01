'use client'

let erudaInstance: unknown = null
let isInitialized = false

/**
 * 动态加载并初始化移动端控制台 (Eruda DevTools)
 * 支持手机 Safari/Chrome 直接查看 Console、Network 请求、Elements DOM 和 Storage
 */
export async function initErudaMobileDevTools(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (isInitialized && erudaInstance) {
    try {
      ;(erudaInstance as { show?: () => void }).show?.()
    } catch {
      /* ignore */
    }
    return true
  }
  try {
    const eruda = (await import('eruda')).default
    eruda.init({
      defaults: {
        displaySize: 65,
        transparency: 0.95,
        theme: 'Dark',
      },
    })
    erudaInstance = eruda
    isInitialized = true
    try {
      localStorage.setItem('chaya_remote_play_devtools', '1')
    } catch {
      /* ignore */
    }
    return true
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize eruda mobile devtools', err)
    }
    return false
  }
}

export function isErudaActive(): boolean {
  return isInitialized
}

export function hideErudaMobileDevTools() {
  if (erudaInstance) {
    try {
      ;(erudaInstance as { hide?: () => void }).hide?.()
    } catch {
      /* ignore */
    }
  }
}

export function showErudaMobileDevTools() {
  if (erudaInstance) {
    try {
      ;(erudaInstance as { show?: () => void }).show?.()
    } catch {
      /* ignore */
    }
  }
}

export function destroyErudaMobileDevTools() {
  if (erudaInstance) {
    try {
      ;(erudaInstance as { destroy?: () => void }).destroy?.()
    } catch {
      /* ignore */
    }
    erudaInstance = null
    isInitialized = false
    try {
      localStorage.removeItem('chaya_remote_play_devtools')
    } catch {
      /* ignore */
    }
  }
}
