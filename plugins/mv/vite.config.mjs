import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPluginConfig } from '../shared/vite-config.mjs'
const moduleRoot = path.dirname(fileURLToPath(import.meta.url))
export function createPluginsViteConfig(entry, emptyOutDir = false, opts = {}) {
  return createPluginConfig(moduleRoot, entry, emptyOutDir, opts)
}
export default createPluginsViteConfig({ name: 'ChayaEdit', entry: 'src/cheat/index.ts', react: true }, true)
