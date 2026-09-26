import os from 'node:os'

import type { NextConfig } from 'next'

/** 开发态经局域网 IP 打开时，放行 HMR / `_next/*`（否则页面能开但脚本被拦） */
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
  // Electron 安装包用 standalone；Vercel / 普通 `next build` 不设，避免多余产物
  ...(process.env.CHAYA_ELECTRON_BUILD === '1' ? { output: 'standalone' as const } : {}),
}

export default nextConfig
