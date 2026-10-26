export type OfflineMetadata = Record<string, string>
export type OfflineUpdate = {
  protocolVersion: 1
  packageId: string
  packageVersion: string
  metadata: OfflineMetadata
  content: string
}

/** Offline transport carries metadata, never its own trusted bootstrap root. */
export function parseOfflineUpdate(input: string): OfflineUpdate {
  if (Buffer.byteLength(input, 'utf8') > 2_500_000) throw new Error('Offline update exceeds size limit')
  const value = JSON.parse(input) as OfflineUpdate
  if (
    !value ||
    value.protocolVersion !== 1 ||
    typeof value.packageId !== 'string' ||
    typeof value.packageVersion !== 'string' ||
    typeof value.content !== 'string' ||
    Buffer.byteLength(value.content, 'utf8') > 700_000 ||
    !value.metadata ||
    typeof value.metadata !== 'object' ||
    Array.isArray(value.metadata)
  )
    throw new Error('Invalid offline update')
  const names = Object.keys(value.metadata)
  if (names.length > 35 || !['timestamp.json', 'snapshot.json', 'targets.json'].every((name) => names.includes(name))) throw new Error('Missing offline metadata')
  for (const [name, content] of Object.entries(value.metadata)) {
    if (!/^(?:[1-9]\d*\.root|timestamp|snapshot|targets)\.json$/.test(name) || typeof content !== 'string') throw new Error('Invalid offline metadata file')
    if (Buffer.byteLength(content, 'utf8') > (name === 'targets.json' ? 1_000_000 : 65_536)) throw new Error('Offline metadata exceeds size limit')
  }
  return value
}
