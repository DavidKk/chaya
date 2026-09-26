/** 服务进程内一次推理；当前对话排在后台补译前，取消后不再占用队列。 */
type Task = { interactive: boolean; signal?: AbortSignal; run: () => Promise<void>; reject: (error: unknown) => void }
const queue: Task[] = []
let running = false

function drain() {
  if (running) return
  const index = queue.findIndex((task) => task.interactive)
  const next = queue.splice(index >= 0 ? index : 0, 1)[0]
  if (!next) return
  if (next.signal?.aborted) {
    next.reject(next.signal.reason)
    drain()
    return
  }
  running = true
  void next.run().finally(() => {
    running = false
    drain()
  })
}

export function scheduleOllama<T>(run: () => Promise<T>, interactive = false, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const cancel = () => {
      const index = queue.indexOf(task)
      if (index >= 0) queue.splice(index, 1)
      reject(signal?.reason)
    }
    const task: Task = {
      interactive,
      signal,
      reject,
      run: async () => {
        try {
          resolve(await run())
        } catch (error) {
          reject(error)
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
      },
    }
    signal?.addEventListener('abort', cancel, { once: true })
    queue.push(task)
    drain()
  })
}
