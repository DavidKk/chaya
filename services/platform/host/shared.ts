import { spawn } from 'node:child_process'
import fs from 'node:fs'

export function assertPathExists(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`路径不存在: ${targetPath}`)
  }
}

export function spawnDetached(command: string, args: string[], opts?: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      cwd: opts?.cwd,
      windowsHide: false,
      shell: false,
    })
    child.on('error', reject)
    child.unref()
    resolve()
  })
}
