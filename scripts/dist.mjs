#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const target = args[0] || (process.platform === 'darwin' ? '--mac' : '--win')

// 1. Build app standalone package
execFileSync('pnpm', ['build:app'], { cwd: root, stdio: 'inherit' })

// 2. Run electron-builder
const builderBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
execFileSync(builderBin, [target, '--config', 'electron-builder.yml', '--publish', 'never'], { cwd: root, stdio: 'inherit' })

// 3. Post-build zip packaging on macOS
if (target === '--mac') {
  execFileSync(process.execPath, [path.join(root, 'scripts/build/package-mac-zip.mjs')], { cwd: root, stdio: 'inherit' })
}
