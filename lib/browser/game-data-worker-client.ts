let workerRequestId = 0

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

/** Parse JSON outside the UI thread; the static URL form is handled by Next's bundler. */
export async function parseGameJsonBatch(texts: string[], signal: AbortSignal): Promise<unknown[]> {
  if (signal.aborted) throw abortError(signal)
  const worker = new Worker(new URL('./game-data-json.worker.ts', import.meta.url))
  const id = ++workerRequestId
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'JSON Worker 运行失败'))
    }
    worker.onmessage = (event: MessageEvent<{ id: number; values?: unknown[]; error?: string }>) => {
      if (event.data.id !== id) return
      finish()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.values ?? [])
    }
    worker.postMessage({ id, texts })
  })
}
