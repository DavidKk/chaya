type ParseRequest = { id: number; texts: string[] }
type ParseResponse = { id: number; values?: unknown[]; error?: string }

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, texts } = event.data
  try {
    const response: ParseResponse = { id, values: texts.map((text) => JSON.parse(text) as unknown) }
    self.postMessage(response)
  } catch (error) {
    const response: ParseResponse = { id, error: error instanceof Error ? error.message : 'JSON 解析失败' }
    self.postMessage(response)
  }
}

export {}
