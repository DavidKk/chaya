export type TurnEvent = {
  type: string
  seq?: number
  turnId?: string
  sessionId?: string
  text?: string
  brief?: string
  message?: string
  question?: string
  name?: string
  phase?: string
  summary?: string
  step?: number
  maxSteps?: number
  callId?: string
  ok?: boolean
  durationMs?: number
  input?: Record<string, unknown>
  output?: unknown
  usage?: unknown
  model?: string
  content?: string
  role?: string
  card?: unknown
}

/** 逐条读取 Agent Turn 的 SSE `data:` 事件，直到流结束或 `signal` 取消 */
export async function readTurnEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TurnEvent) => void,
  options: { signal?: AbortSignal; onReader?: (reader: ReadableStreamDefaultReader<Uint8Array>) => void } = {}
) {
  const reader = body.getReader()
  options.onReader?.(reader)
  const decoder = new TextDecoder()
  let buffer = ''
  while (!options.signal?.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const data = chunk
        .split(/\r?\n/)
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim()
      if (data) onEvent(JSON.parse(data) as TurnEvent)
    }
  }
  return reader
}
