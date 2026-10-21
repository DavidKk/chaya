import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

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

const REQUEST_TIMEOUT_MS = 5_000

export function toBergamotLanguage(value: string | undefined, fallback: string): string {
  const code = String(value || fallback)
    .trim()
    .toLowerCase()
  if (code === 'ch' || code === 'zh-cn' || code === 'zh-hans') return 'zh'
  if (code === 'cht' || code === 'zh-tw' || code === 'zh-hant') return 'zh-TW'
  if (code === 'pt-br') return 'pt'
  return code
}

function candidatePaths(): string[] {
  const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : process.platform
  const arch = process.arch
  return [
    ...(process.env.CHAYA_BERGAMOT_BINARY ? [path.resolve(process.env.CHAYA_BERGAMOT_BINARY)] : []),
    path.resolve(process.cwd(), `native/bin/${platform}-${arch}/chaya-bergamot-translator`),
    path.resolve(process.cwd(), 'native/bin/chaya-bergamot-translator'),
    path.join(os.homedir(), '.local', 'bin', 'chaya-bergamot-translator'),
    ...(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'chaya-bergamot-translator')),
  ]
}

function resolveBinary(): string {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Bergamot translation is supported on macOS and Linux only')
  const binary = candidatePaths().find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  })
  if (!binary) throw new Error('Bergamot translator binary not found. Install chaya-bergamot-translator and its language pack first.')
  return binary
}

class BergamotTranslatorClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private lines: readline.Interface | null = null
  private idleTimer: NodeJS.Timeout | null = null

  private start(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child
    const child = spawn(resolveBinary(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    const child = this.start()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const id = `bergamot-${++this.sequence}`
    return new Promise<BergamotResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.child === child) this.stopDaemon(new Error('Offline translation timeout: bergamot did not respond within 5000ms'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, action, from: toBergamotLanguage(options?.source, 'ja'), to: toBergamotLanguage(options?.target, 'zh'), text })}\n`, (error) => {
        if (!error) return
        if (this.child === child) this.stopDaemon(error)
      })
    })
  }

  async checkStatus(source = 'ja', target = 'zh'): Promise<{ status: 'ready' | 'model_pack_missing' | 'unavailable'; installed: boolean; message?: string; path?: string }> {
    try {
      const response = await this.request('check', { source, target })
      if (response.success !== true) throw new Error(response.message || response.error || 'Bergamot language pack check failed')
      if (typeof response.installed !== 'boolean') throw new Error('Invalid Bergamot language pack response')
      return { status: response.installed ? 'ready' : 'model_pack_missing', installed: response.installed, path: response.path }
    } catch (error) {
      return { status: 'unavailable', installed: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async translate(text: string, options?: { source?: string; target?: string }): Promise<string> {
    if (!text.trim()) return text
    const response = await this.request('translate', options, text)
    const result = response.translatedText ?? response.result
    if (response.success !== true || typeof result !== 'string') throw new Error(response.message || response.error || 'Bergamot translation failed')
    return result
  }
}

export const bergamotTranslator = new BergamotTranslatorClient()

export function bergamotTranslate(text: string, options?: { source?: string; target?: string }): Promise<string> {
  return bergamotTranslator.translate(text, options)
}
