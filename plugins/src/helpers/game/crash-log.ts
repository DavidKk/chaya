import { ChayaLog } from '../net/logger'
import { hookMethod } from './method-hook'

const g = globalThis as typeof globalThis & { __chayaCrashLogDispose?: () => void }

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  // window 'error' handlers (SceneManager.onError) receive an ErrorEvent
  const event = error as { error?: unknown; message?: unknown; filename?: unknown; lineno?: unknown } | null
  if (event && typeof event === 'object') {
    if (event.error instanceof Error) return describe(event.error)
    if (typeof event.message === 'string') return [event.message, event.filename ? `${event.filename}:${event.lineno ?? ''}` : ''].filter(Boolean).join(' @ ')
  }
  return String(error)
}

/** 游戏弹出错误画面时把堆栈写进日志；错误画面本身照旧 */
export function startCrashLog() {
  if (typeof SceneManager === 'undefined') return
  g.__chayaCrashLogDispose?.()
  const disposers = ['catchException', 'onError'].map((key) =>
    hookMethod(
      SceneManager,
      key,
      (original) =>
        function (this: unknown, error: unknown, ...rest: unknown[]) {
          try {
            ChayaLog.fail('GameError', describe(error))
          } catch {
            /* logging must never mask the game's own error screen */
          }
          return original.call(this, error, ...rest)
        }
    )
  )
  g.__chayaCrashLogDispose = () => disposers.forEach((dispose) => dispose())
}
