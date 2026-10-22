import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import readline from 'node:readline'

export const CHAYA_TO_APPLE_LANG_MAP: Record<string, string> = {
  ja: 'ja',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-TW': 'zh-Hant',
  'zh-hans': 'zh-Hans',
  'zh-Hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-Hant': 'zh-Hant',
  ch: 'zh-Hans',
  cht: 'zh-Hant',
  en: 'en',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  it: 'it',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-BR': 'pt-BR',
}

export function toAppleLanguage(lang: string | undefined, defaultVal: string): string {
  if (!lang) return defaultVal
  const direct = CHAYA_TO_APPLE_LANG_MAP[lang]
  if (direct) return direct
  const lower = CHAYA_TO_APPLE_LANG_MAP[lang.toLowerCase()]
  if (lower) return lower
  return lang
}

interface DaemonRequest {
  id: string
  type: 'translate' | 'check' | 'ping'
  text?: string
  source?: string
  target?: string
}

interface DaemonResponse {
  id: string
  success: boolean
  result?: string
  status?: string
  error?: string
  message?: string
}

class AppleTranslatorClient {
  private process: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private pendingRequests = new Map<string, { resolve: (res: DaemonResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout; dispose?: () => void }>()
  private batches = new Map<string, Set<string>>()
  private batchTimings = new Map<string, { started: number; items: number; failed: number; first: boolean }>()
  private batchQueue: DaemonRequest[] = []
  private batchScheduled = false
  private binaryStamp = ''
  private reqSeq = 0
  private idleTimer: NodeJS.Timeout | null = null
  private readonly idleTimeoutMs = 60_000

  private getBinaryPath(): string | null {
    const binPath = resolve(process.cwd(), 'native/bin/chaya-apple-translator')
    return existsSync(binPath) ? binPath : null
  }

  isSupportedPlatform(): boolean {
    return process.platform === 'darwin'
  }

  private startDaemon(): ChildProcess {
    const binPath = this.getBinaryPath()
    if (!binPath) {
      throw new Error(`Apple translator binary not found at native/bin/chaya-apple-translator. Run native/apple-translator/build.sh first.`)
    }

    const stat = statSync(binPath)
    const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}`
    if (this.process && !this.process.killed) {
      if (this.binaryStamp === stamp || this.pendingRequests.size) return this.process
      // Switch binaries only after every current request has settled.
      this.stopDaemon()
    }
    this.binaryStamp = stamp

    const proc = spawn(binPath, [], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    if (!proc.stdout || !proc.stdin) {
      throw new Error('Failed to create stdio streams for translator daemon')
    }

    const rl = readline.createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      try {
        const res = JSON.parse(line) as DaemonResponse
        const ids = this.batches.get(res.id) || new Set([res.id])
        for (const id of ids) this.finishRequest(id, { ...res, id })
      } catch {
        // ignore malformed lines
      }
    })

    proc.on('exit', () => {
      if (this.process === proc) this.cleanupProcess()
    })

    proc.on('error', (err) => {
      console.warn('[macos-translate] Daemon process error:', err.message)
      if (this.process === proc) this.cleanupProcess()
    })
    proc.stdin.on('error', () => {
      if (this.process === proc) this.cleanupProcess()
    })

    this.process = proc
    this.rl = rl
    if (process.env.CHAYA_TRANSLATE_DEBUG === '1') console.info(`[apple-timing] Daemon started: pid=${proc.pid ?? 'unknown'}`)
    return proc
  }

  private finishRequest(id: string, response?: DaemonResponse, error?: Error) {
    const pending = this.pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pending.dispose?.()
    this.pendingRequests.delete(id)
    for (const [batchId, ids] of this.batches) {
      if (!ids.has(id)) continue
      const timing = this.batchTimings.get(batchId)
      if (timing) {
        if (!timing.first) {
          timing.first = true
          if (process.env.CHAYA_TRANSLATE_DEBUG === '1')
            console.info(
              `[apple-timing] First batch outcome: id=${batchId}, elapsedMs=${Math.round(performance.now() - timing.started)}, success=${!error && response?.success === true}`
            )
        }
        if (error || !response?.success) timing.failed++
      }
      ids.delete(id)
      if (!ids.size) {
        if (timing)
          if (process.env.CHAYA_TRANSLATE_DEBUG === '1')
            console.info(`[apple-timing] Batch settled: id=${batchId}, items=${timing.items}, failed=${timing.failed}, elapsedMs=${Math.round(performance.now() - timing.started)}`)
        this.batches.delete(batchId)
        this.batchTimings.delete(batchId)
      }
    }
    if (error) pending.reject(error)
    else pending.resolve(response!)
    if (!this.pendingRequests.size) this.resetIdleTimer()
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.pendingRequests.size) {
        this.resetIdleTimer()
        return
      }
      this.stopDaemon()
    }, this.idleTimeoutMs)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  private cleanupProcess() {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    this.process = null
    this.batchQueue = []
    for (const [id, timing] of this.batchTimings)
      if (process.env.CHAYA_TRANSLATE_DEBUG === '1')
        console.info(`[apple-timing] Batch interrupted: id=${id}, pending=${this.batches.get(id)?.size ?? 0}, elapsedMs=${Math.round(performance.now() - timing.started)}`)
    this.batches.clear()
    this.batchTimings.clear()
    // Reject any remaining pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer)
      req.dispose?.()
      req.reject(new Error(`Translator process exited before completing request ${id}`))
    }
    this.pendingRequests.clear()
  }

  stopDaemon() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.process) {
      this.process.kill()
      this.cleanupProcess()
    }
  }

  private enqueueTranslation(payload: DaemonRequest) {
    this.batchQueue.push(payload)
    if (this.batchScheduled) return
    this.batchScheduled = true
    queueMicrotask(() => {
      this.batchScheduled = false
      const queue = this.batchQueue.filter((item) => this.pendingRequests.has(item.id))
      this.batchQueue = []
      const groups = new Map<string, DaemonRequest[]>()
      for (const item of queue) {
        const key = JSON.stringify([item.source, item.target])
        groups.set(key, [...(groups.get(key) || []), item])
      }
      for (const items of groups.values()) {
        let batch: DaemonRequest[] = []
        let chars = 0
        const flush = () => {
          if (!batch.length) return
          const batchId = `batch:${batch[0].id}`
          this.batches.set(batchId, new Set(batch.map((item) => item.id)))
          this.batchTimings.set(batchId, { started: performance.now(), items: batch.length, failed: 0, first: false })
          if (process.env.CHAYA_TRANSLATE_DEBUG === '1')
            console.info(
              `[apple-timing] Batch dispatched: id=${batchId}, atMs=${Date.now()}, pid=${this.process?.pid ?? 'unknown'}, items=${batch.length}, sourceChars=${batch.reduce((sum, item) => sum + Array.from(item.text || '').length, 0)}, from=${batch[0].source}, to=${batch[0].target}`
            )
          try {
            if (!this.process?.stdin || this.process.stdin.destroyed) throw new Error('Translator process is unavailable')
            this.process.stdin.write(
              JSON.stringify({
                id: batchId,
                type: 'batch',
                source: batch[0].source,
                target: batch[0].target,
                items: batch.map((item) => ({ id: item.id, text: item.text })),
              }) + '\n'
            )
          } catch (error) {
            for (const item of batch) this.finishRequest(item.id, undefined, error instanceof Error ? error : new Error(String(error)))
          }
          batch = []
          chars = 0
        }
        for (const item of items) {
          if (batch.length >= 40 || chars + (item.text?.length || 0) > 40_000) flush()
          batch.push(item)
          chars += item.text?.length || 0
        }
        flush()
      }
    })
  }

  private async sendRequest(req: Omit<DaemonRequest, 'id'>, timeoutMs = 15_000, signal?: AbortSignal): Promise<DaemonResponse> {
    if (!this.isSupportedPlatform()) {
      throw new Error('Apple Translation is only supported on macOS')
    }

    signal?.throwIfAborted()
    const proc = this.startDaemon()
    this.resetIdleTimer()

    const id = `${Date.now()}-${++this.reqSeq}`
    const payload: DaemonRequest = { ...req, id }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishRequest(id, undefined, new Error(`Apple translation request ${id} timed out after ${timeoutMs}ms`))
        // Do not leave timed-out native work in front of the next batch.
        if (!this.pendingRequests.size) this.stopDaemon()
      }, timeoutMs)

      const abort = () => {
        this.finishRequest(id, undefined, signal?.reason instanceof Error ? signal.reason : new Error('Translation request cancelled'))
        if (!this.pendingRequests.size) this.stopDaemon()
      }
      this.pendingRequests.set(id, { resolve, reject, timer, dispose: () => signal?.removeEventListener('abort', abort) })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      if (payload.type === 'translate') this.enqueueTranslation(payload)
      else {
        try {
          proc.stdin!.write(JSON.stringify(payload) + '\n')
        } catch (error) {
          this.finishRequest(id, undefined, error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
  }

  async checkStatus(source = 'ja', target = 'zh-Hans'): Promise<{ status: string; installed: boolean; message?: string }> {
    try {
      const res = await this.sendRequest({
        type: 'check',
        source: toAppleLanguage(source, 'ja'),
        target: toAppleLanguage(target, 'zh-Hans'),
      })
      return {
        status: res.status || 'unknown',
        installed: res.status === 'installed',
        message: res.message,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 'error',
        installed: false,
        message,
      }
    }
  }

  async translate(text: string, options?: { source?: string; target?: string; signal?: AbortSignal }): Promise<string> {
    if (!text || !text.trim()) return text
    if (text.length > 20_000) throw new Error('Apple translation text exceeds 20000 characters')

    const res = await this.sendRequest(
      {
        type: 'translate',
        text,
        source: toAppleLanguage(options?.source, 'ja'),
        target: toAppleLanguage(options?.target, 'zh-Hans'),
      },
      15_000,
      options?.signal
    )

    if (!res.success) {
      let message = res.message || res.error || 'Apple translation failed'
      if (res.error === 'not_installed' || message === 'Unable to Translate') {
        message = 'Apple offline language pack not installed. Please download the language pack in macOS System Settings -> General -> Language & Region -> Translation Languages.'
      }
      const err = new Error(message)
      ;(err as unknown as { code?: string }).code = res.error
      throw err
    }

    return res.result || ''
  }
}

export const appleTranslator = new AppleTranslatorClient()

export async function appleTranslate(text: string, options?: { source?: string; target?: string; signal?: AbortSignal }): Promise<string> {
  return appleTranslator.translate(text, options)
}
