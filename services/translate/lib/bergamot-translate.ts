import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

import { bergamotLanguage } from '@/lib/translate/bergamot'
import { resolveBergamotBinary } from '@/services/translate/bergamot/binary'
import { findPack } from '@/services/translate/bergamot/catalog'
import { verifiedPack } from '@/services/translate/bergamot/readiness'
import { installedPack } from '@/services/translate/bergamot/store'
import { measureOperation } from '@/services/log/operation'

type BergamotResponse = {
  id?: string
  success?: boolean
  translatedText?: string
  result?: string
  error?: string
  message?: string
  installed?: boolean
  path?: string
}

type PendingRequest = { resolve: (value: BergamotResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
type BergamotStatus = { status: 'ready' | 'model_pack_missing' | 'unavailable' | 'unsupported'; installed: boolean; message?: string; path?: string }

const REQUEST_TIMEOUT_MS = 5_000

export function toBergamotLanguage(value: string | undefined, fallback: string): string {
  const code = String(value || fallback)
    .trim()
    .toLowerCase()
  if (code === 'jp') return 'ja'
  if (code === 'ch' || code === 'zh-cn' || code === 'zh-hans') return 'zh'
  if (code === 'cht' || code === 'zh-tw' || code === 'zh-hant') return 'zh-TW'
  if (code === 'pt-br') return 'pt'
  return code
}

class BergamotTranslatorClient {
  constructor(private readonly packRoot?: string) {}

  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private lines: readline.Interface | null = null
  private idleTimer: NodeJS.Timeout | null = null

  private start(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child
    const child = spawn(resolveBergamotBinary(), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.packRoot ? { env: { ...process.env, CHAYA_BERGAMOT_PACKS_DIR: this.packRoot } } : {}),
    })
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (this.child === child) this.handleLine(line)
    })
    child.stderr.on('data', () => {})
    const fail = (error: Error) => {
      if (this.child === child) this.stopDaemon(error)
    }
    child.on('error', fail)
    child.stdin.on('error', fail)
    child.stdout.on('error', fail)
    child.on('exit', () => fail(new Error('Bergamot translator process exited')))
    this.child = child
    this.lines = lines
    return child
  }

  private handleLine(line: string) {
    let response: BergamotResponse
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      response = parsed as BergamotResponse
    } catch {
      return
    }
    if (!response.id) return
    const request = this.pending.get(response.id)
    if (!request) return
    clearTimeout(request.timer)
    this.pending.delete(response.id)
    request.resolve(response)
    this.scheduleIdleStop()
  }

  stopDaemon(error = new Error('Bergamot translator stopped')) {
    const child = this.child
    this.child = null
    this.lines?.close()
    this.lines = null
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    child?.kill('SIGKILL')
    if (this.packRoot && managedClients.get(this.packRoot) === this) managedClients.delete(this.packRoot)
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer)
      request.reject(error)
      this.pending.delete(id)
    }
  }

  private scheduleIdleStop() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!this.pending.size) {
      this.idleTimer = setTimeout(() => this.stopDaemon(), 60_000)
      this.idleTimer.unref()
    }
  }

  private async request(action: 'translate' | 'check', options?: { source?: string; target?: string }, text?: string): Promise<BergamotResponse> {
    return measureOperation(
      'communication',
      'bergamot.native.request',
      {
        action,
        source: options?.source || 'ja',
        target: options?.target || 'zh',
        sourceChars: Array.from(text || '').length,
      },
      () => this.requestOnce(action, options, text)
    )
  }

  private async requestOnce(action: 'translate' | 'check', options?: { source?: string; target?: string }, text?: string): Promise<BergamotResponse> {
    if (!this.packRoot) {
      const root = installedPack(options?.source || 'ja', options?.target || 'zh')?.root
      if (root) {
        const verified = await verifiedPack(options?.source || 'ja', options?.target || 'zh')
        if (!verified) throw new Error('PACK_MODEL_INVALID')
        return managedClient(verified.root).request(action, options, text)
      }
    }
    const child = this.start()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const id = `bergamot-${++this.sequence}`
    return new Promise<BergamotResponse>((resolve, reject) => {
      const timeoutMs = this.packRoot ? 30_000 : REQUEST_TIMEOUT_MS
      const timer = setTimeout(() => {
        if (this.child === child) this.stopDaemon(new Error(`Offline translation timeout: bergamot did not respond within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(
        `${JSON.stringify({ id, action, from: this.packRoot ? bergamotLanguage(options?.source || 'ja') : toBergamotLanguage(options?.source, 'ja'), to: this.packRoot ? bergamotLanguage(options?.target || 'zh') : toBergamotLanguage(options?.target, 'zh'), text })}\n`,
        (error) => {
          if (!error) return
          if (this.child === child) this.stopDaemon(error)
        }
      )
    })
  }

  async checkStatus(source = 'ja', target = 'zh'): Promise<BergamotStatus> {
    source = bergamotLanguage(source)
    target = bergamotLanguage(target)
    if (!findPack(source, target)) return { status: 'unsupported', installed: false }
    try {
      if (installedPack(source, target)) {
        const verified = await verifiedPack(source, target)
        return { status: verified ? 'ready' : 'model_pack_missing', installed: !!verified }
      }
      const response = await this.request('check', { source, target })
      if (response.success !== true) throw new Error(response.message || response.error || 'Bergamot language pack check failed')
      if (typeof response.installed !== 'boolean') throw new Error('Invalid Bergamot language pack response')
      return { status: response.installed ? 'ready' : 'model_pack_missing', installed: response.installed, path: response.path }
    } catch (error) {
      return { status: 'unavailable', installed: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Readiness always describes the requested pair, never another installed model. */
  async checkEngineStatus(source = 'en', target = 'zh') {
    source = bergamotLanguage(source)
    target = bergamotLanguage(target)
    return { ...(await this.checkStatus(source, target)), source, target }
  }

  async translate(text: string, options?: { source?: string; target?: string }): Promise<string> {
    if (!text.trim()) return text
    return measureOperation(
      'translate',
      'bergamot.request',
      { source: options?.source || 'ja', target: options?.target || 'zh', items: 1, sourceChars: Array.from(text).length },
      async () => {
        const response = await this.request('translate', options, text)
        const result = response.translatedText ?? response.result
        if (response.success !== true || typeof result !== 'string') throw new Error(response.message || response.error || 'Bergamot translation failed')
        return result
      }
    )
  }
}

const managedClients = new Map<string, BergamotTranslatorClient>()
function managedClient(root: string) {
  let client = managedClients.get(root)
  if (!client) {
    if (managedClients.size >= 8) throw new Error('BERGAMOT_TOO_MANY_ACTIVE_INSTALLATIONS')
    client = new BergamotTranslatorClient(root)
    managedClients.set(root, client)
  }
  return client
}

export const bergamotTranslator = new BergamotTranslatorClient()

export function bergamotTranslate(text: string, options?: { source?: string; target?: string }): Promise<string> {
  return bergamotTranslator.translate(text, options)
}
