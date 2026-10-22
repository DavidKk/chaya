import { spawn } from 'node:child_process'

import { resolveBergamotBinary } from '@/services/translate/bergamot/binary'

/** A separate process, never the in-game daemon. The fixed pack root is an internal capability. */
export function validateBergamotPack(root: string, source: string, target: string, sample: { text: string; expected: string }, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(resolveBergamotBinary(), [], { env: { ...process.env, CHAYA_BERGAMOT_PACKS_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      child.kill('SIGKILL')
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('PACK_CANCELLED'))
    const timer = setTimeout(() => finish(new Error('PACK_VALIDATION_FAILED')), 120_000)
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', () => finish(new Error('BERGAMOT_COMPONENT_UNAVAILABLE')))
    child.stdin.on('error', () => finish(new Error('PACK_VALIDATION_FAILED')))
    child.stderr.on('data', () => {})
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.length > 64_000) return finish(new Error('PACK_VALIDATION_FAILED'))
      if (!output.includes('\n')) return
      try {
        const response = JSON.parse(output.split('\n')[0])
        if (response.success !== true || typeof response.translatedText !== 'string' || !response.translatedText.includes(sample.expected))
          return finish(new Error('PACK_MODEL_INCOMPATIBLE'))
        finish()
      } catch {
        finish(new Error('PACK_VALIDATION_FAILED'))
      }
    })
    child.on('exit', () => {
      if (!settled) finish(new Error('PACK_VALIDATION_FAILED'))
    })
    child.stdin.end(JSON.stringify({ id: 'validate', action: 'translate', from: source, to: target, text: sample.text }) + '\n')
  })
}
