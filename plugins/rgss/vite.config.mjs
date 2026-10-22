import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPluginConfig } from '../shared/vite-config.mjs'
const moduleRoot = path.dirname(fileURLToPath(import.meta.url))
export function createPluginsViteConfig(entry, emptyOutDir = false, opts = {}) {
  const config = createPluginConfig(moduleRoot, entry, emptyOutDir, opts)
  config.plugins.push({
    name: 'rgss-overlay-html',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'rgss-overlay.html',
        source:
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chaya RGSS</title><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}</style></head><body><script src="./ChayaRGSSOverlay.js"></script></body></html>',
      })
    },
  })
  return config
}
export default createPluginsViteConfig({ name: 'ChayaRGSSOverlay', entry: 'src/entry.tsx', react: true }, true)
