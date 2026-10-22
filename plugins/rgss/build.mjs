import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

import { createPluginsViteConfig } from './vite.config.mjs'
const watch = process.argv.includes('--watch')
const config = createPluginsViteConfig({ name: 'ChayaRGSSOverlay', entry: 'src/entry.tsx', react: true }, !watch, { dev: watch })
await build({ ...config, build: { ...config.build, ...(watch ? { watch: {} } : {}) } })

if (process.platform === 'darwin') execFileSync('sh', [fileURLToPath(new URL('./native/build.sh', import.meta.url))], { stdio: 'inherit' })
