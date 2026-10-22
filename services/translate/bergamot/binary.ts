import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function resolveBergamotBinary(): string {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('BERGAMOT_PLATFORM_UNSUPPORTED')
  const platform = process.platform === 'darwin' ? 'macos' : 'linux'
  const candidates = [
    ...(process.env.CHAYA_BERGAMOT_BINARY ? [path.resolve(process.env.CHAYA_BERGAMOT_BINARY)] : []),
    path.resolve(process.cwd(), `native/bin/${platform}-${process.arch}/chaya-bergamot-translator`),
    path.resolve(process.cwd(), 'native/bin/chaya-bergamot-translator'),
    path.join(os.homedir(), '.local/bin/chaya-bergamot-translator'),
    ...(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'chaya-bergamot-translator')),
  ]
  const binary = candidates.find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  })
  if (!binary) throw new Error('BERGAMOT_COMPONENT_UNAVAILABLE')
  return binary
}
