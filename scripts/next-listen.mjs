#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import listenAddress from './listen-address.cjs'
import localAccess from './local-access.cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

function rewriteListenLine(line, host, lanIp) {
  return line.replace(/(- (?:Local|Network):\s+)https?:\/\/([^\s:]+|\[[^\]]+\]):(\d+)/, (_match, prefix, _hostname, port) => {
    return `${prefix}${listenAddress.serviceUrl(host, port, lanIp)}`
  })
}

function pipeRewrite(stream, write, host, lanIp) {
  let buf = ''
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    const parts = buf.split(/\r?\n/)
    buf = parts.pop() ?? ''
    for (const line of parts) {
      write(rewriteListenLine(line, host, lanIp) + '\n')
    }
  })
  stream.on('end', () => {
    if (buf) write(rewriteListenLine(buf, host, lanIp))
  })
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/next-listen.mjs <dev|start> [...next args]')
  process.exit(1)
}

const lanIp = listenAddress.detectLanIpv4()
const hostIndex = args.findIndex((argument) => argument === '-H' || argument === '--hostname')
const host = hostIndex >= 0 ? args[hostIndex + 1] : '0.0.0.0'
const portIndex = args.findIndex((a) => a === '-p' || a === '--port')
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 3927
// The server derives the compat `/api/mcp` URL from PORT (`toolkitListenPort`).
process.env.PORT = String(port)
if (process.env.CHAYA_SERVICE !== 'remote' && process.env.VERCEL !== '1') {
  process.env.CHAYA_AUTH_TOKEN = localAccess.ensureAccessToken()
  console.log(`[Chaya] console: ${listenAddress.serviceUrl(host, port, lanIp)}`)
}
const child = spawn(process.execPath, [nextBin, ...args], {
  cwd: root,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

pipeRewrite(child.stdout, (s) => process.stdout.write(s), host, lanIp)
pipeRewrite(child.stderr, (s) => process.stderr.write(s), host, lanIp)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}
