import os from 'node:os'

import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

import type { BuildTarget } from './lib/service-mode/target'

/** Allow HMR / `_next/*` when opened via LAN IP in dev (page loads but scripts would otherwise be blocked). */
function allowedDevHosts(): string[] {
  const hosts = new Set<string>(['127.0.0.1', 'localhost'])
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || (a.family as unknown) === 4
      if (v4 && !a.internal) hosts.add(a.address)
    }
  }
  return [...hosts]
}

function buildTarget(phase: string): BuildTarget {
  if (phase === PHASE_DEVELOPMENT_SERVER) return 'dev'
  if (process.env.VERCEL === '1' || process.env.CHAYA_TARGET?.trim().toLowerCase() === 'edge') return 'edge'
  return 'server'
}

const BASE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js']
const withSuffix = (suffix: string) => BASE_EXTENSIONS.map((ext) => `${suffix}.${ext}`)

/** `*.server.*` 路由只进 dev / server 构建；`*.dev.*` 只进 dev。edge 构建按扩展名直接不收录这些文件。 */
function pageExtensions(target: BuildTarget): string[] {
  if (target === 'dev') return [...withSuffix('dev'), ...withSuffix('server'), ...BASE_EXTENSIONS]
  if (target === 'server') return [...withSuffix('server'), ...BASE_EXTENSIONS]
  return BASE_EXTENSIONS
}

export default function nextConfig(phase: string): NextConfig {
  const target = buildTarget(phase)
  const electron = process.env.CHAYA_ELECTRON_BUILD === '1'
  if (electron && target === 'edge') throw new Error('CHAYA_ELECTRON_BUILD 需要 server 构建，不能与 edge 同时开启')
  return {
    allowedDevOrigins: allowedDevHosts(),
    pageExtensions: pageExtensions(target),
    env: { NEXT_PUBLIC_CHAYA_TARGET: target },
    // Electron installers need standalone; skip for Vercel / plain `next build`
    ...(electron ? { output: 'standalone' as const } : {}),
  }
}
