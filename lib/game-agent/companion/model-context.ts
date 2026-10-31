type TextMessage = { role: string; content: string }

/** Keep mandatory instructions and the newest request intact; discard only whole older messages. */
export function trimCompanionContext<T extends TextMessage>(messages: T[], contextChars: number): T[] {
  const system = messages.filter((message) => message.role === 'system').map((message) => ({ ...message }))
  const rest = messages.filter((message) => message.role !== 'system')
  const newest = rest.at(-1)
  let used = system.reduce((sum, message) => sum + message.content.length, 0) + (newest?.content.length ?? 0)
  if (used > contextChars) {
    throw Object.assign(new Error('Required model context exceeds budget'), { code: 'REQUEST_CONFLICT', retryable: false })
  }
  const older: T[] = []
  for (let i = rest.length - 2; i >= 0; i--) {
    const item = rest[i]!
    if (used + item.content.length > contextChars) break
    older.unshift({ ...item })
    used += item.content.length
  }
  return [...system, ...older, ...(newest ? [{ ...newest }] : [])]
}
