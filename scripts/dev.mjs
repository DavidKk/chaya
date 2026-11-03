#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import concurrently from 'concurrently'

import ensureListenPortMod from './server/ensure-listen-port.cjs'

const { ensureListenPort } = ensureListenPortMod
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const isApp = args.includes('--app')
const isLoopback = args.includes('--loopback')
const service = isApp ? 'app' : 'local'
const apiLan = isLoopback ? '0' : '1'
const host = isLoopback ? '127.0.0.1' : '0.0.0.0'
const isSymlinkNodeModules = (() => {
  try {
    return fs.lstatSync(path.join(root, 'node_modules')).isSymbolicLink()
  } catch {
    return false
  }
})()
const webpackFlag = args.includes('--webpack') || isSymlinkNodeModules ? '--webpack ' : ''
const port = process.env.PORT || '3000'

// 1. Prebuild translate workers & plugins, and ensure target port is free
execFileSync(process.execPath, [path.join(root, 'services/translate/build.mjs')], { cwd: root, stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'plugins/build.mjs')], { cwd: root, stdio: 'inherit' })
await ensureListenPort(port)

// 2. Concurrently run watchers and services
const commands = [
  {
    command: `node scripts/server/next-listen.mjs dev ${webpackFlag}-p ${port} -H ${host}`,
    name: 'next',
    prefixColor: 'blue',
    env: { CHAYA_SERVICE: service, CHAYA_API_LAN: apiLan },
  },
  {
    command: 'node services/translate/build.mjs --watch',
    name: 'translate',
    prefixColor: 'yellow',
  },
  {
    command: 'node plugins/build.mjs --watch',
    name: 'plugins',
    prefixColor: 'magenta',
  },
  {
    command: 'node scripts/server/rgss-dev-sync.mjs',
    name: 'rgss-sync',
    prefixColor: 'cyan',
    env: { CHAYA_PORT: String(port) },
  },
]

if (isApp) {
  commands.push({
    command: 'node ./node_modules/electron/cli.js .',
    name: 'electron',
    prefixColor: 'green',
    env: {
      CHAYA_SERVICE: 'app',
      CHAYA_API_LAN: '1',
      CHAYA_ELECTRON_EXTERNAL: '1',
      PORT: String(port),
      CHAYA_HOST: 'localhost',
    },
  })
}

const { result } = concurrently(commands, {
  cwd: root,
  killOthers: ['failure', 'success'],
})

result.catch((error) => {
  if (Array.isArray(error)) {
    const failed = error.find((e) => e.exitCode !== 0 && e.exitCode !== null)
    if (failed) process.exit(failed.exitCode ?? 1)
  }
  process.exit(0)
})
