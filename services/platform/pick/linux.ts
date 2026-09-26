import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

import { isCancelError, normalizeSelected } from './shared'
import type { PickKind, PickPathCapability, PickResult } from './types'

const execFileAsync = promisify(execFile)

type LinuxDialogTool = 'zenity' | 'kdialog' | 'yad'

async function whichLinuxDialog(): Promise<LinuxDialogTool | null> {
  for (const name of ['zenity', 'kdialog', 'yad'] as const) {
    try {
      await execFileAsync('sh', ['-c', `command -v ${name}`], { timeout: 5_000 })
      return name
    } catch {
      /* try next */
    }
  }
  return null
}

async function linuxPickFolder(tool: LinuxDialogTool, label: string): Promise<string | null> {
  try {
    if (tool === 'kdialog') {
      const { stdout } = await execFileAsync('kdialog', ['--title', 'Chaya', '--getexistingdirectory', os.homedir(), label], {
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
      })
      return normalizeSelected(stdout) || null
    }
    const { stdout } = await execFileAsync(tool, ['--file-selection', '--directory', `--title=${label}`, `--filename=${os.homedir()}/`], {
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    return normalizeSelected(stdout) || null
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? Number((err as { code?: number }).code) : NaN
    if (code === 1 || code === 2) return null
    throw err
  }
}

async function linuxPickShellFile(tool: LinuxDialogTool, label: string): Promise<string | null> {
  try {
    if (tool === 'kdialog') {
      const { stdout } = await execFileAsync('kdialog', ['--title', label, '--getopenfilename', os.homedir(), 'nw nwjs|nw nwjs|*|'], {
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
      })
      return normalizeSelected(stdout) || null
    }
    const { stdout } = await execFileAsync(
      tool,
      ['--file-selection', `--title=${label}`, `--filename=${os.homedir()}/`, '--file-filter=NW.js | nw nwjs', '--file-filter=All | *'],
      { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 }
    )
    return normalizeSelected(stdout) || null
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? Number((err as { code?: number }).code) : NaN
    if (code === 1 || code === 2) return null
    throw err
  }
}

export class LinuxPickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  defaultPrompt(kind: PickKind): string {
    if (kind === 'app') return '选择干净的 NW.js（nw 可执行文件）作为壳源'
    return '选择 RPG Maker 游戏目录（含 www、内容根，或已打包的 .app / 发布目录）'
  }

  async pick(kind: PickKind, prompt?: string): Promise<PickResult> {
    const label = prompt || this.defaultPrompt(kind)
    const tool = await whichLinuxDialog()
    if (!tool) {
      return {
        ok: false,
        error: '未找到 zenity / kdialog / yad，请安装其一后再用选择器（或手动粘贴路径）',
      }
    }

    try {
      const selected = kind === 'app' ? await linuxPickShellFile(tool, label) : await linuxPickFolder(tool, label)
      if (!selected) return { ok: false, cancelled: true }
      return { ok: true, path: selected }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isCancelError(msg)) return { ok: false, cancelled: true }
      return { ok: false, error: msg }
    }
  }
}
