#!/usr/bin/env node
/**
 * Bing / Google / Ollama 合并翻译
 *   pnpm translate -- --root /path/to/www
 */
import { initRuntime } from './lib/env'
import { main } from './lib/main'

initRuntime()
main().catch((err: unknown) => {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : err
  console.error('翻译失败:', message)
  process.exit(1)
})
