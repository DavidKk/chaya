import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { escapeAppleScript, isCancelError } from './shared'
import type { PickKind, PickPathCapability, PickResult } from './types'

const execFileAsync = promisify(execFile)

async function runOsascript(source: string): Promise<string> {
  const file = path.join(os.tmpdir(), `chaya-pick-${process.pid}-${Date.now()}.applescript`)
  fs.writeFileSync(file, `${source}\n`, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/osascript', [file], {
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const errText = String(stderr || '').trim()
    if (errText && !String(stdout || '').trim()) throw new Error(errText)
    return String(stdout || '').trim()
  } finally {
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}

function scriptForApp(prompt: string): string {
  const p = escapeAppleScript(prompt)
  return `
try
  tell me to activate
end try
POSIX path of (choose file of type {"com.apple.application-bundle", "app"} with prompt "${p}")
`.trim()
}

function scriptForFolder(prompt: string): string {
  const p = escapeAppleScript(prompt)
  return `
try
  tell me to activate
end try
POSIX path of (choose folder with prompt "${p}")
`.trim()
}

export class OsxPickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  defaultPrompt(kind: PickKind): string {
    if (kind === 'app') return '选择干净的 NW.js（.app）作为壳源'
    return '选择 RPG Maker 游戏目录（含 www、内容根，或已打包的 .app / 发布目录）'
  }

  async pick(kind: PickKind, prompt?: string): Promise<PickResult> {
    const label = prompt || this.defaultPrompt(kind)
    try {
      const selected = (kind === 'app' ? await runOsascript(scriptForApp(label)) : await runOsascript(scriptForFolder(label))).replace(/\/$/, '')
      if (!selected) return { ok: false, cancelled: true }
      return { ok: true, path: selected }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isCancelError(msg)) return { ok: false, cancelled: true }
      return { ok: false, error: msg }
    }
  }
}
