import fs from 'node:fs'
import path from 'node:path'

import type { TranslationObservation } from '@/lib/translate/observation'
import { createResourceMatcher } from '@/lib/translate/resource-matcher'
import { canonicalResourceLanguage, type ResourceSnapshot } from '@/lib/translate/resource-types'
import { storageCall } from '@/services/storage/client'

import { observationSpoolDirectory } from '../observations/spool'
import { RESOURCE_LIMITS } from './validate'

/** Versioned local data management, through the same single writer as translations. */
function main(argv: string[]) {
  const [command, first, second, third] = argv
  const requireArgument = (value: string | undefined, label: string) => {
    if (!value) throw new Error(`Missing ${label}`)
    return value
  }
  const readPack = (file: string | undefined) => {
    const input = requireArgument(file, 'JSONL file')
    if (fs.statSync(input).size > RESOURCE_LIMITS.bytes) throw new Error('Resource package exceeds size limit')
    return fs.readFileSync(input, 'utf8')
  }
  switch (command) {
    case 'collect': {
      const directory = observationSpoolDirectory()
      let imported = 0
      if (!fs.existsSync(directory)) return { imported }
      for (const name of fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.jsonl'))
        .sort()) {
        const file = path.join(directory, name)
        if (fs.statSync(file).size > 6_000_000) throw new Error(`Observation spool too large: ${name}`)
        const events = fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
        for (let offset = 0; offset < events.length; offset += 4) {
          imported += storageCall<{ inserted: number }>('observations.append', [events.slice(offset, offset + 4)]).inserted
        }
        fs.unlinkSync(file)
      }
      return { imported }
    }
    case 'observations': {
      const result = storageCall<{ nextCursor: number; items: TranslationObservation[] }>('observations.export', [
        {
          after: first === undefined ? 0 : Number(first),
          sourceLanguage: second,
          targetLanguage: third,
        },
      ])
      for (const item of result.items) process.stdout.write(JSON.stringify(item) + '\n')
      process.stderr.write(`nextCursor=${result.nextCursor}\n`)
      return
    }
    case 'list':
      return storageCall('resources.list', [])
    case 'preview':
      return storageCall('resources.preview', [readPack(first)])
    case 'import': {
      const content = readPack(first)
      const preview = storageCall<{ token: string }>('resources.preview', [content])
      return storageCall('resources.apply', [content, preview.token])
    }
    case 'apply':
      return storageCall('resources.apply', [readPack(first), requireArgument(second, 'preview token')])
    case 'disable':
      return storageCall('resources.disable', [requireArgument(first, 'pack ID')])
    case 'activate':
      return storageCall('resources.activate', [requireArgument(first, 'pack ID'), requireArgument(second, 'version')])
    case 'export':
      process.stdout.write(storageCall<string>('resources.export', [requireArgument(first, 'pack ID'), requireArgument(second, 'version')]))
      return
    case 'lookup': {
      const snapshot = storageCall<ResourceSnapshot>('resources.snapshot', [])
      return createResourceMatcher(snapshot).match(requireArgument(third, 'text'), {
        sourceLanguage: canonicalResourceLanguage(requireArgument(first, 'source language')),
        targetLanguage: canonicalResourceLanguage(requireArgument(second, 'target language')),
      })
    }
    default:
      throw new Error(
        'Usage: pnpm translate:resources list | import FILE | preview FILE | apply FILE TOKEN | disable PACK | activate PACK VERSION | export PACK VERSION | lookup FROM TO TEXT | collect | observations [AFTER_CURSOR] [SOURCE] [TARGET]'
      )
  }
}
try {
  const result = main(process.argv.slice(2))
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
