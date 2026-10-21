import fs from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { parseRubyMarshal, type RubyArray } from '@/services/extract/lib/rgss/marshal'

/** Read a single VX Ace archive member without unpacking or changing the game. */
function readAceMember(archive: string, member: string): Buffer | null {
  const fd = fs.openSync(archive, 'r')
  let cursor = 0
  const length = fs.fstatSync(fd).size
  const read = (size: number, offset = cursor) => {
    if (size < 0 || offset + size > length) throw new Error('Truncated RGSS archive')
    const bytes = Buffer.alloc(size)
    if (fs.readSync(fd, bytes, 0, size, offset) !== size) throw new Error('Truncated RGSS archive')
    cursor = offset + size
    return bytes
  }
  try {
    const header = read(12)
    if (!header.subarray(0, 8).equals(Buffer.from('RGSSAD\0\x03', 'binary'))) throw new Error('Unsupported RGSS archive version')
    const key = (Math.imul(header.readUInt32LE(8), 9) + 3) >>> 0
    for (let count = 0; count < 100_000; count++) {
      const record = read(16)
      const offset = (record.readUInt32LE(0) ^ key) >>> 0
      if (!offset) return null
      const size = (record.readUInt32LE(4) ^ key) >>> 0
      let fileKey = (record.readUInt32LE(8) ^ key) >>> 0
      const nameSize = (record.readUInt32LE(12) ^ key) >>> 0
      if (nameSize > 4096) throw new Error('Invalid RGSS archive filename')
      const name = read(nameSize)
      for (let i = 0; i < name.length; i++) name[i] ^= (key >>> ((i % 4) * 8)) & 255
      if (name.toString().replaceAll('\\', '/').toLowerCase() !== member.toLowerCase()) continue
      if (size > 32 * 1024 * 1024) throw new Error('RGSS script archive exceeds 32 MiB')
      const bytes = read(size, offset)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= (fileKey >>> ((i % 4) * 8)) & 255
        if (i % 4 === 3) fileKey = (Math.imul(fileKey, 7) + 3) >>> 0
      }
      return bytes
    }
    throw new Error('RGSS archive has too many members')
  } finally {
    fs.closeSync(fd)
  }
}

export function readRgssScripts(contentRoot: string): Array<{ name: string; source: string }> {
  const names = fs.readdirSync(contentRoot)
  const data = names.find((name) => name.toLowerCase() === 'data')
  const script = data && fs.readdirSync(path.join(contentRoot, data)).find((name) => /^scripts\.rvdata2?$/i.test(name))
  const archive = names.find((name) => name.toLowerCase() === 'game.rgss3a')
  const bytes = script ? fs.readFileSync(path.join(contentRoot, data!, script)) : archive ? readAceMember(path.join(contentRoot, archive), 'Data/Scripts.rvdata2') : null
  if (!bytes) return []
  const value = parseRubyMarshal(bytes)
  if (!value || typeof value !== 'object' || value.kind !== 'array') return []
  return value.items.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || entry.kind !== 'array') return []
    const [, name, packed] = (entry as RubyArray).items
    if (!packed || typeof packed !== 'object' || packed.kind !== 'string' || !packed.bytes) return []
    return [
      {
        name: name && typeof name === 'object' && name.kind === 'string' ? name.value : '',
        source: inflateSync(packed.bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8'),
      },
    ]
  })
}
