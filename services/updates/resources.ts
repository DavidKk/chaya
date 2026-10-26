import type { UpdatePackage } from '@/lib/updates/protocol'
import { storageCall } from '@/services/storage/client'
import { parseResourcePack } from '@/services/translate/resources/validate'

export type ResourceUpdatePort = {
  install(content: string): void
  activate(packId: string, version: string): void
  list(): { packId: string; version: string; active: number }[]
}

export const resourceUpdatePort: ResourceUpdatePort = {
  install(content) {
    const preview = storageCall<{ token: string }>('resources.preview', [content])
    storageCall('resources.install', [content, preview.token])
  },
  activate(packId, version) {
    storageCall('resources.activate', [packId, version])
  },
  list() {
    return storageCall('resources.list', [])
  },
}

export function validateResourceUpdate(descriptor: UpdatePackage, content: string): void {
  if (descriptor.kind !== 'translation-resource') throw new Error('Matching capability installation is not enabled in this delivery')
  const pack = parseResourcePack(content)
  if (pack.manifest.packId !== descriptor.resource?.packId || pack.manifest.version !== descriptor.resource.version)
    throw new Error('Resource manifest differs from signed package identity')
}
