export function hasAllControlTokens(src: string, zh: string): boolean {
  const tokens = src.match(/__C\d+__/g) || []
  return tokens.every((token) => zh.includes(token))
}

/** Preserve whole clauses and control codes; an indivisible clause must not bypass the request limit. */
export function splitSentenceByNaturalBoundaries(text: string, maxChars: number): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid Agent request character limit')
  if (Array.from(text).length <= maxChars) return [text]

  const protectedRanges: Array<{ start: number; end: number }> = []
  const tokenRegex = /(__C\d+__|\\(?:[A-Za-z]+)\[[^\]]*\])/g
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(text)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  const isProtected = (pos: number) => protectedRanges.some((r) => pos > r.start && pos < r.end)
  const charOffsets = new Uint32Array(text.length + 1)
  let offset = 0,
    count = 0
  for (const char of text) {
    offset += char.length
    charOffsets[offset] = ++count
  }

  const boundaries = [...text.matchAll(/\r?\n+|[。！？!?…；;，,、]+|\.{3,}|\.(?=\s|$)/g)].map((entry) => entry.index! + entry[0].length).filter((end) => !isProtected(end))
  boundaries.push(text.length)
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let splitIndex = -1
    for (const end of boundaries) {
      if (end <= start) continue
      if (charOffsets[end] - charOffsets[start] > maxChars) break
      splitIndex = end
    }
    if (splitIndex < 0) {
      throw new Error(`A text clause exceeds the Agent request limit (${maxChars} characters) and has no safe sentence boundary; increase the request character limit`)
    }
    chunks.push(text.slice(start, splitIndex))
    start = splitIndex
  }
  return chunks
}

export function packBatches<T extends { text: string }>(items: T[], maxChars: number): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentChars = 0

  for (const item of items) {
    const chars = Array.from(item.text).length
    if (current.length && currentChars + chars > maxChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += chars
  }
  if (current.length) batches.push(current)
  return batches
}

export function buildBatchTranslatePrompt(texts: string[]): { system: string; user: string } {
  const system = [
    '你是专精游戏本地化的翻译器，将日文或英文原文逐行翻译为简体中文。',
    '必须严格遵循以下规则：',
    '1. 占位符（例如 __C0__、__C1__ 等）必须完全原样保留，不得修改、遗漏或移动。',
    '2. 严格按 [序号] 格式逐条输出对应的简体中文译文，序号必须与输入一一对应。',
    '3. 保持与输入相同的条目数量，绝不能合并、遗漏或跳过任何一条。',
    '4. 仅输出翻译结果，不要输出任何前言、总结、思考过程或解释说明。',
  ].join('\n')

  const lines = texts.map((text, i) => `[${i + 1}] ${text}`)
  const user = `请按 [序号] 格式将以下每条文本翻译为简体中文：\n${lines.join('\n')}`

  return { system, user }
}

export function parseBatchResponse(raw: string, count: number): Array<string | null> {
  const cleaned = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim()
  const lines = cleaned.split(/\r?\n/)
  const result: Array<string | null> = new Array(count).fill(null)

  let currentIndex = -1
  const linePattern = /^\s*(?:\[(\d+)\]|(\d+)[\.、：:]|\((\d+)\))\s*(.*)$/

  for (const line of lines) {
    const match = linePattern.exec(line)
    if (match) {
      const idxStr = match[1] || match[2] || match[3]
      const idx = parseInt(idxStr, 10)
      if (idx >= 1 && idx <= count) {
        currentIndex = idx - 1
        result[currentIndex] = match[4].trim()
        continue
      }
    }
    if (currentIndex >= 0 && result[currentIndex] !== null) {
      result[currentIndex] += '\n' + line
    }
  }

  for (let i = 0; i < count; i++) {
    if (result[i] !== null) {
      result[i] = result[i]!.replace(/^["「『]+|["」』]+$/g, '').trim()
    }
  }

  return result
}
