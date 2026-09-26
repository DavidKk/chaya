import os from 'node:os'

import type { NextConfig } from 'next'

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

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevHosts(),
  // Electron installers need standalone; skip for Vercel / plain `next build`
  ...(process.env.CHAYA_ELECTRON_BUILD === '1' ? { output: 'standalone' as const } : {}),
}

export default nextConfig
