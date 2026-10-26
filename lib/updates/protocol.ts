import { UPDATE_HOST_API, UPDATE_REPOSITORY } from '@/constants/updates'

export type UpdatePackage = {
  protocolVersion: 1
  packageId: string
  packageVersion: string
  kind: 'translation-resource' | 'expressive-matcher'
  contentSchemaVersion: 1
  hostApi: { min: number; max: number }
  activationPolicy: 'next-batch'
  url: string
  length: number
  sha256: string
  notes: string
  resource?: { packId: string; version: string }
}

export function safePackageId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value) || value.includes('..')) throw new Error('Invalid package ID')
  return value
}

export function packageVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Expected stable SemVer package version')
  if (value.split('.').some((part) => !Number.isSafeInteger(Number(part)))) throw new Error('Package version exceeds integer limit')
  return value
}

export function comparePackageVersions(left: string, right: string): number {
  const a = packageVersion(left).split('.').map(Number)
  const b = packageVersion(right).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** Releases URLs are signed target attributes, never URLs supplied by an update request. */
export function assertOfficialAsset(value: string): void {
  const url = new URL(value)
  const prefix = `/${UPDATE_REPOSITORY}/releases/download/`
  const pieces = url.pathname.slice(prefix.length).split('/')
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix) ||
    pieces.length !== 2 ||
    pieces.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)) ||
    pieces[0] === 'latest'
  )
    throw new Error('Package must use an explicit official GitHub release asset')
}

export function parseUpdatePackage(value: unknown): UpdatePackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid update descriptor')
  const item = value as UpdatePackage
  safePackageId(item.packageId)
  packageVersion(item.packageVersion)
  if (
    item.protocolVersion !== 1 ||
    item.contentSchemaVersion !== 1 ||
    !['translation-resource', 'expressive-matcher'].includes(item.kind) ||
    item.activationPolicy !== 'next-batch' ||
    !item.hostApi ||
    !Number.isSafeInteger(item.hostApi.min) ||
    !Number.isSafeInteger(item.hostApi.max) ||
    item.hostApi.min < 1 ||
    item.hostApi.max < item.hostApi.min ||
    !Number.isSafeInteger(item.length) ||
    item.length < 1 ||
    item.length > (item.kind === 'translation-resource' ? 700_000 : 2_000_000) ||
    typeof item.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.sha256) ||
    typeof item.notes !== 'string' ||
    item.notes.length > 4000 ||
    typeof item.url !== 'string'
  )
    throw new Error('Invalid update descriptor fields')
  assertOfficialAsset(item.url)
  if (item.kind === 'translation-resource') {
    if (!item.resource || typeof item.resource.packId !== 'string' || typeof item.resource.version !== 'string') throw new Error('Missing resource identity')
    for (const field of [item.resource.packId, item.resource.version]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(field)) throw new Error('Invalid resource identity')
    }
    // Official updates must not activate or replace a user-owned package.
    if (!item.resource.packId.startsWith('chaya.')) throw new Error('Official resources require the chaya. namespace')
    if (item.resource.packId !== item.packageId) throw new Error('Resource package ID must equal its manifest pack ID')
  } else if (item.packageId !== 'chaya.expressive-matcher') throw new Error('Unknown matching capability')
  return {
    protocolVersion: 1,
    packageId: item.packageId,
    packageVersion: item.packageVersion,
    kind: item.kind,
    contentSchemaVersion: 1,
    hostApi: { min: item.hostApi.min, max: item.hostApi.max },
    activationPolicy: 'next-batch',
    url: item.url,
    length: item.length,
    sha256: item.sha256,
    notes: item.notes,
    ...(item.kind === 'translation-resource' ? { resource: { packId: item.resource!.packId, version: item.resource!.version } } : {}),
  }
}

export function assertCompatible(item: UpdatePackage): void {
  if (item.hostApi.min > UPDATE_HOST_API || item.hostApi.max < UPDATE_HOST_API) throw new Error('Package requires a different host API; update the App')
}

export function selectUpdates(items: UpdatePackage[]): UpdatePackage[] {
  const latest = new Map<string, UpdatePackage>()
  const identities = new Map<string, string>()
  for (const item of items) {
    const key = `${item.packageId}@${item.packageVersion}`
    const serialized = JSON.stringify(item)
    if (identities.has(key) && identities.get(key) !== serialized) throw new Error('Conflicting package identity')
    identities.set(key, serialized)
    if (item.hostApi.min > UPDATE_HOST_API || item.hostApi.max < UPDATE_HOST_API) continue
    const previous = latest.get(item.packageId)
    if (!previous || comparePackageVersions(item.packageVersion, previous.packageVersion) > 0) latest.set(item.packageId, item)
  }
  return [...latest.values()].sort((a, b) => a.packageId.localeCompare(b.packageId))
}
