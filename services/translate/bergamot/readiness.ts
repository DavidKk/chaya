import fs from 'node:fs'
import path from 'node:path'

import { resolveBergamotBinary } from './binary'
import { findPack } from './catalog'
import { hashFile } from './download'
import { validateBergamotPack } from './native'
import { contentId, installedPack, pairFolder } from './store'

const checks = new Map<string, Promise<boolean>>()
/** Shared queue: status probes do not load models into the gameplay daemon. */
let queue: Promise<unknown> = Promise.resolve()
export async function verifiedPack(source: string, target: string, refresh = false) {
  const installed = installedPack(source, target)
  const pack = findPack(source, target)
  if (!installed || !pack) return
  let binary: string
  try {
    binary = resolveBergamotBinary()
  } catch {
    return
  }
  const stat = fs.statSync(binary)
  const key = contentId({ installed, binary, size: stat.size, mtime: stat.mtimeMs })
  if (refresh) checks.delete(key)
  let check = checks.get(key)
  if (!check) {
    check = queue
      .then(async () => {
        if ((await hashFile(binary)) !== installed.manifest.binaryHash) return false
        for (const item of installed.manifest.files) {
          if ((await hashFile(path.join(installed.root, pairFolder(source, target), item.name))) !== item.sha256) return false
        }
        await validateBergamotPack(installed.root, pack.source, pack.target, pack.sample)
        return true
      })
      .catch(() => false)
    queue = check
    if (checks.size > 32) checks.clear()
    checks.set(key, check)
  }
  return (await check) ? installed : undefined
}
