import { MemoryStaleError } from '@/lib/game-agent/companion/memory-errors'
import type { MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'

import { tryNodeFsPath } from '../node/node-require'
import { pluginStorageCall } from './client'

type Pending = { id: string; method: 'game.append' | 'companion.commit'; args: unknown[] }
const queues = new Map<string, Promise<void>>()
const awaitingOutcomes = new Map<string, { stale: boolean }>()

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
  const stale = new Set<string>()
  const markStale = (id: string) => {
    stale.add(id)
    const outcome = awaitingOutcomes.get(id)
    if (outcome) outcome.stale = true
  }
  if (!fs.existsSync(file)) return stale
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
      if (item.method === 'companion.commit') {
        if (await isStale(item)) {
          markStale(item.id)
        } else {
          try {
            await pluginStorageCall(item.method, item.args)
          } catch (error) {
            // A management fence may have advanced after the first check.
            if (!(await isStale(item))) throw error
            markStale(item.id)
          }
        }
      } else await pluginStorageCall(item.method, item.args)
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
  return stale
}

async function isStale(item: Pending): Promise<boolean> {
  const batch = item.args[1] as MemoryWriteBatch
  const snapshot = await pluginStorageCall<MemoryStoreSnapshot>('companion.load', [item.args[0], null, item.args[2]])
  if (!snapshot) throw new Error('Companion memory state unavailable')
  // Legacy offline management cannot allocate authoritative versions.
  return Boolean(
    batch.clear ||
    batch.setRecording !== undefined ||
    batch.memoryEpoch !== snapshot.memoryEpoch ||
    batch.recordingRevision !== snapshot.recordingRevision ||
    (!snapshot.recordingEnabled &&
      (batch.episodes?.length || 0) +
        (batch.evidence?.length || 0) +
        (batch.saveLinks?.length || 0) +
        (batch.projections?.length || 0) +
        (batch.battleRecording?.events.length || 0) >
        0)
  )
}

function flushWithResult(root: string): Promise<Set<string>> {
  const operation = (queues.get(root) || Promise.resolve()).then(() => drain(root))
  queues.set(
    root,
    operation.then(
      () => undefined,
      () => undefined
    )
  )
  return operation
}

export async function flushPendingStorage(root: string): Promise<void> {
  await flushWithResult(root)
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
  // Another queued flush may consume this entry before our own flush starts.
  const outcome = { stale: false }
  awaitingOutcomes.set(id, outcome)
  try {
    await flushWithResult(root)
    if (outcome.stale) throw new MemoryStaleError('Offline memory record discarded after management change')
  } finally {
    awaitingOutcomes.delete(id)
  }
}
