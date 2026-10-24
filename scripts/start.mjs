#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ensureListenPortMod from './server/ensure-listen-port.cjs'

const { ensureListenPort } = ensureListenPortMod
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const isLoopback = args.includes('--loopback')
const host = isLoopback ? '127.0.0.1' : '0.0.0.0'
const apiLan = isLoopback ? '0' : '1'
const port = process.env.PORT || '3927'

await ensureListenPort(port)

const child = spawn(process.execPath, [path.join(root, 'scripts/server/next-listen.mjs'), 'start', '-p', port, '-H', host], {
  cwd: root,
  env: { ...process.env, CHAYA_API_LAN: apiLan },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}
