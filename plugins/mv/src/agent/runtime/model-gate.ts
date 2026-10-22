export const MODEL_FAILURE_COOLDOWN_MS = 15_000

/**
 * 游戏内所有模型代理请求的唯一闸口：同一时刻只放行一个；模型端失败后冷却一段时间，
 * 冷却期内的调用（含已在排队的）直接复用该错误，不再打到服务。
 */
export function createModelGate(cooldownMs = MODEL_FAILURE_COOLDOWN_MS, now = Date.now) {
  let queue: Promise<unknown> = Promise.resolve()
  let failure: { message: string; until: number } | null = null
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = queue.then(() => {
        if (failure && now() < failure.until) throw Object.assign(new Error(failure.message), { nonRetryable: true, cooling: true })
        return task()
      })
      queue = next.catch(() => undefined)
      return next
    },
    trip(error: Error) {
      failure = { message: error.message, until: now() + cooldownMs }
    },
    reset() {
      failure = null
    },
  }
}
