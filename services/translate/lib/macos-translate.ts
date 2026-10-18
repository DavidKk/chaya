import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import readline from 'node:readline'

export const CHAYA_TO_APPLE_LANG_MAP: Record<string, string> = {
  ja: 'ja',
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  en: 'en',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  it: 'it',
}

export function toAppleLanguage(lang: string | undefined, defaultVal: string): string {
  if (!lang) return defaultVal
  return CHAYA_TO_APPLE_LANG_MAP[lang] || lang
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
  private pendingRequests = new Map<string, { resolve: (res: DaemonResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
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
    if (this.process && !this.process.killed) {
      return this.process
    }

    const binPath = this.getBinaryPath()
    if (!binPath) {
      throw new Error(`Apple translator binary not found at native/bin/chaya-apple-translator. Run native/apple-translator/build.sh first.`)
    }

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
        const pending = this.pendingRequests.get(res.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(res.id)
          pending.resolve(res)
        }
      } catch {
        // ignore malformed lines
      }
    })

    proc.on('exit', () => {
      this.cleanupProcess()
    })

    proc.on('error', (err) => {
      console.warn('[macos-translate] Daemon process error:', err.message)
      this.cleanupProcess()
    })

    this.process = proc
    this.rl = rl
    return proc
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
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
    // Reject any remaining pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer)
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

  private async sendRequest(req: Omit<DaemonRequest, 'id'>, timeoutMs = 15_000): Promise<DaemonResponse> {
    if (!this.isSupportedPlatform()) {
      throw new Error('Apple Translation is only supported on macOS')
    }

    const proc = this.startDaemon()
    this.resetIdleTimer()

    const id = `${Date.now()}-${++this.reqSeq}`
    const payload: DaemonRequest = { ...req, id }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Apple translation request ${id} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })
      proc.stdin!.write(JSON.stringify(payload) + '\n')
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

  async translate(text: string, options?: { source?: string; target?: string }): Promise<string> {
    if (!text || !text.trim()) return text

    const res = await this.sendRequest({
      type: 'translate',
      text,
      source: toAppleLanguage(options?.source, 'ja'),
      target: toAppleLanguage(options?.target, 'zh-Hans'),
    })

    if (!res.success) {
      const err = new Error(res.message || res.error || 'Apple translation failed')
      ;(err as unknown as { code?: string }).code = res.error
      throw err
    }

    return res.result || ''
  }
}

export const appleTranslator = new AppleTranslatorClient()

export async function appleTranslate(text: string, options?: { source?: string; target?: string }): Promise<string> {
  return appleTranslator.translate(text, options)
}
