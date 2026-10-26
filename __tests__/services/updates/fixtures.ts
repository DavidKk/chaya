import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { Readable } from 'node:stream'

import { BaseFetcher } from 'tuf-js'
import { DownloadHTTPError } from 'tuf-js/dist/error'

import { UPDATE_METADATA_URL } from '@/constants/updates'
import { parseUpdatePackage } from '@/lib/updates/protocol'
import { serializeResourcePack } from '@/services/translate/resources/validate'

export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const contentFor = (version = '1.0.0', targetText = '啊啊') =>
  serializeResourcePack({
    manifest: {
      type: 'manifest',
      schemaVersion: 1,
      packId: 'chaya.test-ja-zh',
      version,
      languages: [
        { tag: 'ja', name: 'Japanese' },
        { tag: 'zh', name: 'Chinese' },
      ],
    },
    records: [
      {
        type: 'entry',
        entryId: 'test',
        sourceLanguage: 'ja',
        targetLanguage: 'zh',
        sourceText: 'ああ',
        targetText,
        scope: { kind: 'global' },
        reviewStatus: 'reviewed',
        provenance: { kind: 'test' },
        match: { kind: 'exact' },
      },
    ],
  })
export const descriptorFor = (version = '1.0.0', content = contentFor(version)) =>
  parseUpdatePackage({
    protocolVersion: 1,
    packageId: 'chaya.test-ja-zh',
    packageVersion: version,
    kind: 'translation-resource',
    contentSchemaVersion: 1,
    hostApi: { min: 1, max: 1 },
    activationPolicy: 'next-batch',
    url: `https://github.com/DavidKk/chaya/releases/download/resources-test-v${version}/test-${version}.jsonl`,
    length: Buffer.byteLength(content),
    sha256: sha(content),
    notes: 'Fixture only',
    resource: { packId: 'chaya.test-ja-zh', version },
  })

/** Test-only canonical JSON and ephemeral keys. No signing credentials are shipped. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function signedRepository() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const key = { keytype: 'ed25519', scheme: 'ed25519', keyval: { public: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex') } }
  const keyid = sha(canonical(key))
  const expires = new Date(Date.now() + 86_400_000).toISOString()
  function signed(value: Record<string, unknown>) {
    return Buffer.from(JSON.stringify({ signed: value, signatures: [{ keyid, sig: sign(null, Buffer.from(canonical(value)), privateKey).toString('hex') }] }))
  }
  const base = { spec_version: '1.0.31', version: 1, expires }
  const root = signed({
    ...base,
    _type: 'root',
    consistent_snapshot: false,
    keys: { [keyid]: key },
    roles: Object.fromEntries(['root', 'targets', 'timestamp', 'snapshot'].map((role) => [role, { keyids: [keyid], threshold: 1 }])),
  })
  const files = new Map<string, Buffer>()
  function publish(version: number, items = [descriptorFor()], expiry = expires) {
    const targets = signed({
      ...base,
      _type: 'targets',
      version,
      expires: expiry,
      targets: Object.fromEntries(
        items.map((item) => [`${item.packageId}-${item.packageVersion}.jsonl`, { length: item.length, hashes: { sha256: item.sha256 }, custom: { chaya: item } }])
      ),
    })
    const snapshot = signed({
      ...base,
      _type: 'snapshot',
      version,
      expires: expiry,
      meta: { 'targets.json': { version, length: targets.length, hashes: { sha256: sha(targets) } } },
    })
    const timestamp = signed({
      ...base,
      _type: 'timestamp',
      version,
      expires: expiry,
      meta: { 'snapshot.json': { version, length: snapshot.length, hashes: { sha256: sha(snapshot) } } },
    })
    files.set('targets.json', targets)
    files.set('snapshot.json', snapshot)
    files.set('timestamp.json', timestamp)
  }
  class Fetcher extends BaseFetcher {
    async fetch(url: string): Promise<NodeJS.ReadableStream> {
      if (!url.startsWith(UPDATE_METADATA_URL)) throw new Error('Unexpected fixture request')
      const file = files.get(url.slice(UPDATE_METADATA_URL.length))
      if (!file) throw new DownloadHTTPError('Missing fixture', 404)
      return Readable.from(file)
    }
  }
  publish(1)
  return { root, files, publish, fetcher: new Fetcher() }
}
