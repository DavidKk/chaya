/** Standalone Node workers shared by local server and packaged app. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Bundled CJS dependencies may use require for built-in modules.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
}
const targets = [
  { entryPoints: ['services/translate/scheduler/cache-worker.ts'], outfile: 'native/bin/chaya-cache-worker.mjs' },
  { entryPoints: ['services/extract/lib/rgss/items-worker.ts'], outfile: 'native/bin/chaya-rgss-extract-worker.mjs' },
]

async function run() {
  if (process.argv.includes('--watch')) {
    const watchers = await Promise.all(targets.map((t) => context({ ...shared, ...t })))
    await Promise.all(watchers.map((w) => w.watch()))
    return
  }
  await Promise.all(targets.map((t) => build({ ...shared, ...t })))
}

await run()
