#!/usr/bin/env node
/**
 * Pack electron-builder `dir` output into release zips:
 * `release/mac{,-arm64}/Chaya.app` → `release/Chaya-<version>-<arch>-mac.zip`
 * containing `Chaya.app` + `README_FIRST.txt`.
 *
 * Uses `ditto` (not `zip`) so framework symlinks and the code signature survive.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const readme = path.join(root, 'scripts', 'mac-readme-first.txt')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = 'Chaya'

/** electron-builder dir names per arch */
const ARCH_DIRS = [
  { dir: 'mac-arm64', arch: 'arm64' },
  { dir: 'mac', arch: 'x64' },
]

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${result.status})`)
}

let packed = 0
for (const { dir, arch } of ARCH_DIRS) {
  const appPath = path.join(releaseDir, dir, `${productName}.app`)
  if (!existsSync(appPath)) continue

  const staging = mkdtempSync(path.join(os.tmpdir(), 'chaya-mac-zip-'))
  try {
    run('ditto', [appPath, path.join(staging, `${productName}.app`)])
    copyFileSync(readme, path.join(staging, 'README_FIRST.txt'))

    const zipPath = path.join(releaseDir, `${productName}-${version}-${arch}-mac.zip`)
    rmSync(zipPath, { force: true })
    run('ditto', ['-c', '-k', '--sequesterRsrc', staging, zipPath])
    console.log(`[package-mac-zip] ${path.relative(root, zipPath)}`)
    packed += 1
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (packed === 0) {
  throw new Error(`no ${productName}.app found under ${releaseDir}/mac*`)
}
