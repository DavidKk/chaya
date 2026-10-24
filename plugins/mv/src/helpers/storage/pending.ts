import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'

import { tryNodeFsPath } from '../node/node-require'
import { pluginStorageCall } from './client'

type Pending = { id: string; method: 'game.append' | 'companion.commit'; args: unknown[] }
const queues = new Map<string, Promise<void>>()

function target(root: string) {
  const mods = tryNodeFsPath()
  if (!mods) throw new Error('Offline mutation storage requires a Node host')
  const file = mods.path.join(root, 'chaya/translate/pending-mutations.ndjson')
  return { ...mods, file }
}
function read(fs: typeof import('node:fs'), file: string): Pending[] {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const item = JSON.parse(line) as Pending
      if (!item.id || !['game.append', 'companion.commit'].includes(item.method) || !Array.isArray(item.args)) throw new Error('Invalid pending storage mutation; source retained')
      return item
    })
}

async function drain(root: string) {
  const { fs, file } = target(root)
  if (!fs.existsSync(file)) return
  const release = lockCacheFile(fs, file)
  let items: Pending[]
  try {
    items = read(fs, file)
  } finally {
    release()
  }
  const acknowledged = new Set<string>()
  try {
    for (const item of items) {
      await pluginStorageCall(item.method, item.args)
      acknowledged.add(item.id)
    }
  } finally {
    if (acknowledged.size) {
      const unlock = lockCacheFile(fs, file)
      try {
        const retained = read(fs, file).filter((item) => !acknowledged.has(item.id))
        const tmp = `${file}.${process.pid}.tmp`
        const fd = fs.openSync(tmp, 'w', 0o600)
        try {
          fs.writeFileSync(fd, retained.map((item) => JSON.stringify(item)).join('\n') + (retained.length ? '\n' : ''))
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        fs.renameSync(tmp, file)
      } finally {
        unlock()
      }
    }
  }
}

export function flushPendingStorage(root: string): Promise<void> {
  const operation = (queues.get(root) || Promise.resolve()).then(() => drain(root))
  queues.set(
    root,
    operation.catch(() => undefined)
  )
  return operation
}

export async function queueStorageMutation(root: string, method: Pending['method'], args: unknown[]) {
  if (method === 'game.append' && Array.isArray(args[1]) && args[1].length > 500) {
    for (let offset = 0; offset < args[1].length; offset += 500) await queueStorageMutation(root, method, [args[0], args[1].slice(offset, offset + 500)])
    return
  }
  const { fs, path, file } = target(root)
  const id = crypto.randomUUID()
  if (method === 'game.append') args = [args[0], args[1], id]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const release = lockCacheFile(fs, file)
  try {
    appendCacheLines(fs, file, [{ id, method, args } satisfies Pending])
  } finally {
    release()
  }
  await flushPendingStorage(root)
}
