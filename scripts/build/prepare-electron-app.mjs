#!/usr/bin/env node
/**
 * Assemble Electron extraResources: Next standalone + static/public + plugins/mv/dist
 * → `.electron-builder/app-root`
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const catalog = JSON.parse(readFileSync(path.join(root, 'services/translate/bergamot/models.json'), 'utf8'))
if (catalog.some((pack) => pack.platforms.includes(`${process.platform}-${process.arch}`))) {
  const platform = process.platform === 'darwin' ? 'macos' : process.platform
  const binary = path.join(root, `native/bin/${platform}-${process.arch}/chaya-bergamot-translator`)
  accessSync(binary, constants.X_OK)
  const probe = spawnSync(binary, [], {
    input: JSON.stringify({ id: 'packaging', action: 'check', from: 'en', to: 'zh' }) + '\n',
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 65536,
  })
  const response = JSON.parse(probe.stdout?.trim() || '{}')
  if (probe.error || response.id !== 'packaging' || response.success !== true || typeof response.installed !== 'boolean')
    throw new Error('Bergamot native component missing or incompatible; run pnpm build:bergamot before packaging')
}

const standaloneRoot = path.join(root, '.next', 'standalone')
const outRoot = path.join(root, '.electron-builder', 'app-root')

function findServerJs(dir, depth = 0) {
  const direct = path.join(dir, 'server.js')
  if (existsSync(direct)) return direct
  if (depth >= 2) return null
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory()) continue
    const hit = findServerJs(full, depth + 1)
    if (hit) return hit
  }
  return null
}

function copyDir(from, to) {
  if (!existsSync(from)) throw new Error(`missing directory: ${from}`)
  mkdirSync(path.dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

const serverJs = findServerJs(standaloneRoot)
if (!serverJs) {
  console.error('Missing .next/standalone/**/server.js. Run pnpm build:next with CHAYA_ELECTRON_BUILD=1 first.')
  process.exit(1)
}

const standaloneApp = path.dirname(serverJs)
console.log(`[prepare-electron-app] standalone ← ${standaloneApp}`)
console.log(`[prepare-electron-app] out → ${outRoot}`)

rmSync(outRoot, { recursive: true, force: true })
mkdirSync(path.dirname(outRoot), { recursive: true })
cpSync(standaloneApp, outRoot, { recursive: true, verbatimSymlinks: true })

copyDir(path.join(root, '.next', 'static'), path.join(outRoot, '.next', 'static'))

const publicDir = path.join(root, 'public')
if (existsSync(publicDir)) {
  copyDir(publicDir, path.join(outRoot, 'public'))
}

const pluginsDist = path.join(root, 'plugins', 'mv', 'dist')
if (!existsSync(pluginsDist)) {
  console.error('Missing plugins/mv/dist. Run pnpm build:plugins first.')
  process.exit(1)
}
copyDir(pluginsDist, path.join(outRoot, 'plugins', 'mv', 'dist'))
copyDir(path.join(root, 'plugins', 'rgss'), path.join(outRoot, 'plugins', 'rgss'))

const nativeBin = path.join(root, 'native', 'bin')
if (existsSync(nativeBin)) copyDir(nativeBin, path.join(outRoot, 'native', 'bin'))

const manifest = path.join(root, 'plugins', 'mv', 'manifest.json')
if (existsSync(manifest)) {
  mkdirSync(path.join(outRoot, 'plugins', 'mv'), { recursive: true })
  cpSync(manifest, path.join(outRoot, 'plugins', 'mv', 'manifest.json'))
}

console.log('[prepare-electron-app] ok')
