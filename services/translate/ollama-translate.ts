/** 服务内 Ollama 日→中：默认提示词复述原文 / 空结果时换严格提示词再试一次。 */
import { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL, OLLAMA_TRANSLATE_SYSTEM, requestOllama } from '@/lib/translate/engine-http'

import { scheduleOllama } from './ollama-queue'

const OLLAMA_HOST = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
export type LocalTranslateOptions = { model?: string; interactive?: boolean; signal?: AbortSignal }
const OLLAMA_SYSTEM_RETRY = '这是游戏文本本地化任务，请把日文台词译成通顺的简体中文。只输出中文译文，不要复述日文原文，不要道歉或拒绝。'

async function ollamaChat(system: string, user: string, temperature: number, options?: LocalTranslateOptions): Promise<string> {
  return scheduleOllama(
    async () => {
      const signal = options?.signal ?? AbortSignal.timeout(5 * 60 * 1000)
      signal.throwIfAborted()
      return requestOllama(fetch, { host: OLLAMA_HOST, model: options?.model || OLLAMA_MODEL, text: user, system, temperature, interactive: options?.interactive, signal })
    },
    options?.interactive,
    options?.signal
  )
}

function sameText(a: string, b: string): boolean {
  return a.normalize('NFKC').replace(/\s+/g, ' ').trim() === b.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export async function ollamaJaToZh(text: string, options?: LocalTranslateOptions): Promise<string> {
  const q = String(text ?? '').trim()
  if (!q) return q

  const attempts: Array<{ system: string; user: string; temperature: number }> = [
    { system: OLLAMA_TRANSLATE_SYSTEM, user: q, temperature: 0.2 },
    { system: OLLAMA_SYSTEM_RETRY, user: `译文：\n${q}`, temperature: 0.35 },
  ]

  let last = ''
  let lastErr: Error | null = null
  for (const attempt of attempts) {
    /* 交互态只在复述原文 / 空结果时补一次，出错（多为超时）不再重试 */
    if (options?.interactive && lastErr) break
    try {
      const out = await ollamaChat(attempt.system, attempt.user, attempt.temperature, options)
      last = out
      if (!out || sameText(out, q)) continue
      /* 非中文改写（少见）也先返回，交给上层 isUsefulTranslation */
      return out
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  if (lastErr && !last) throw lastErr
  if (!last) throw new Error('模型没有返回译文')
  return last
}
