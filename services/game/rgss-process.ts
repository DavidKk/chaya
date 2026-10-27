import { spawn, type SpawnOptions } from 'node:child_process'
import fs from 'node:fs'

/** Inherit a regular log descriptor so the game can write after its launcher exits. */
export function spawnRgssProcess(binary: string, options: Pick<SpawnOptions, 'cwd' | 'env'>, logPath: string) {
  const output = fs.openSync(logPath, 'a')
  try {
    const child = spawn(binary, [], { ...options, detached: true, windowsHide: true, stdio: ['ignore', output, output] })
    child.unref()
    return child
  } finally {
    fs.closeSync(output)
  }
}
