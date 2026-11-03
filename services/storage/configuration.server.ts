import fs from 'node:fs'
import path from 'node:path'

export function createPublicConfigurationStore(dataDir: string) {
  const files: Record<string, string> = {
    inputAssistance: 'input-assistance/global.json',
    toolSettings: 'game-agent/tool-settings.json',
    remotePlayHost: 'remote-play/settings.json',
  }
  function fileFor(kind: string) {
    if (!Object.hasOwn(files, kind)) throw new Error('Unsupported public configuration')
    return path.join(dataDir, files[kind])
  }
  function read(kind: string): unknown {
    const file = fileFor(kind)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  function write(kind: string, value: unknown, expectedRevision?: number) {
    if (kind === 'inputAssistance') {
      const current = read(kind) as { revision?: number } | null
      const next = value as { revision?: number } | null
      if ((current?.revision ?? 0) !== expectedRevision || next?.revision !== expectedRevision! + 1) throw new Error('REVISION_CONFLICT')
    }
    const file = fileFor(kind)
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
    fs.renameSync(temporary, file)
    return value
  }
  return { read, write }
}
