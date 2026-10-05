#!/usr/bin/env node
/**
 * Assemble Electron extraResources: Next standalone + static/public + plugins/dist
 * → `.electron-builder/app-root`
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

const pluginsDist = path.join(root, 'plugins', 'dist')
if (!existsSync(pluginsDist)) {
  console.error('Missing plugins/dist. Run pnpm build:plugins first.')
  process.exit(1)
}
copyDir(pluginsDist, path.join(outRoot, 'plugins', 'dist'))

const manifest = path.join(root, 'plugins', 'manifest.json')
if (existsSync(manifest)) {
  mkdirSync(path.join(outRoot, 'plugins'), { recursive: true })
  cpSync(manifest, path.join(outRoot, 'plugins', 'manifest.json'))
}

console.log('[prepare-electron-app] ok')
