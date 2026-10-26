import fs from 'node:fs'
import path from 'node:path'

import { prepareOfflineRelease, prepareResourceRelease } from './prepare-release'

const [input, version, output, metadataDirectory] = process.argv.slice(2)
try {
  if (!input || !version || !output) throw new Error('Usage: pnpm updates:prepare INPUT.jsonl VERSION NEW_OUTPUT_DIRECTORY [SIGNED_METADATA_DIRECTORY]')
  if (fs.statSync(input).size > 700_000) throw new Error('Resource package exceeds size limit')
  const release = prepareResourceRelease(fs.readFileSync(input, 'utf8'), version)
  let offline: ReturnType<typeof prepareOfflineRelease> | undefined
  if (metadataDirectory) {
    const files = fs.readdirSync(metadataDirectory).filter((name) => /^(?:[1-9]\d*\.root|timestamp|snapshot|targets)\.json$/.test(name))
    if (files.length > 35) throw new Error('Too many metadata files')
    const metadata = Object.fromEntries(
      files.map((name) => {
        const file = path.join(metadataDirectory, name)
        if (fs.statSync(file).size > (name === 'targets.json' ? 1_000_000 : 65_536)) throw new Error('Metadata exceeds size limit')
        return [name, fs.readFileSync(file, 'utf8')]
      })
    )
    offline = prepareOfflineRelease(release.content, version, metadata)
  }
  // A fresh output directory prevents accidentally overwriting prepared versions.
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, release.asset), release.content)
  fs.writeFileSync(path.join(output, 'target-entry.json'), JSON.stringify({ [release.target]: release.targetEntry }, null, 2) + '\n')
  if (offline) fs.writeFileSync(path.join(output, 'offline-update.json'), JSON.stringify(offline) + '\n')
  process.stdout.write(JSON.stringify({ directory: path.resolve(output), tag: release.tag, asset: release.asset, requiresSignedMetadata: true, makeLatest: false }, null, 2) + '\n')
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
