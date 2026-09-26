import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { isCancelError, normalizeSelected } from './shared'
import type { PickKind, PickPathCapability, PickResult } from './types'

const execFileAsync = promisify(execFile)

async function runPowerShell(ps: string): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  return String(stdout || '')
}

export class WindowsPickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  defaultPrompt(kind: PickKind): string {
    if (kind === 'app') return '选择干净的 NW.js（nw.exe）作为壳源'
    return '选择 RPG Maker 游戏目录（含 www、内容根，或已打包的 .app / 发布目录）'
  }

  async pick(kind: PickKind, prompt?: string): Promise<PickResult> {
    const label = prompt || this.defaultPrompt(kind)
    const title = JSON.stringify(label)
    // 游戏只选目录；已打包旁挂 Game.exe 由 resolveGame 识别。禁止先弹「文件夹 / Game.exe」。
    const ps =
      kind === 'app'
        ? `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ${title}
$d.Filter = 'NW.js (nw.exe)|nw.exe|Executable (*.exe)|*.exe|All files (*.*)|*.*'
$d.FileName = 'nw.exe'
$d.CheckFileExists = $true
if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($d.FileName)
`.trim()
        : `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = ${title}
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($d.SelectedPath)
`.trim()

    try {
      const selected = normalizeSelected(await runPowerShell(ps))
      if (!selected) return { ok: false, cancelled: true }
      return { ok: true, path: selected }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code = typeof err === 'object' && err && 'code' in err ? Number((err as { code?: number }).code) : NaN
      if (code === 2 || isCancelError(msg)) return { ok: false, cancelled: true }
      return { ok: false, error: msg }
    }
  }
}
