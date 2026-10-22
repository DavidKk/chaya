/** The cache worker is a standalone Node entry, shared by local server and packaged app. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = {
  absWorkingDir: root,
  entryPoints: ['services/translate/scheduler/cache-worker.ts'],
  outfile: 'native/bin/chaya-cache-worker.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Bundled CJS dependencies may use require for built-in modules.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
}
if (process.argv.includes('--watch')) {
  const watcher = await context(options)
  await watcher.watch()
} else await build(options)
