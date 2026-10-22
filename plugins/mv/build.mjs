/**
 * 串行 Vite 多入口：每个插件一个自包含 IIFE。
 * `pnpm build:plugins` → 一次构建
 * `pnpm build:plugins:dev` → Vite watch（供 `pnpm dev` 与 Next 并联）
 */
import { build } from 'vite'

import { createPluginsViteConfig } from './vite.config.mjs'

const entries = [
  { name: 'ChayaLoader', entry: 'src/chaya-loader.ts', react: false },
  { name: 'ChayaLog', entry: 'src/entry.ts', react: false },
  { name: 'ChayaBoost', entry: 'src/game-boost.ts', react: false },
  { name: 'ChayaEdit', entry: 'src/cheat/index.ts', react: true },
  { name: 'ChayaTrans', entry: 'src/translator/index.ts', react: false },
  { name: 'ChayaAgent', entry: 'src/agent/index.ts', react: false },
]

const watch = process.argv.includes('--watch')

async function buildAll() {
  for (const [i, entry] of entries.entries()) {
    await build(createPluginsViteConfig(entry, i === 0, { dev: false }))
    console.log(`[plugins] vite → ${entry.name}.js`)
  }
}

async function watchAll() {
  console.log('[plugins] watch 中… 改 src / 共用 React 后自动重打 dist（局内可热替换）')
  // dist 已由 `build:plugins` 填好；并行 watch 不再 emptyOutDir，避免互踩
  await Promise.all(
    entries.map(async (entry) => {
      const cfg = createPluginsViteConfig(entry, false, { dev: true })
      await build({
        ...cfg,
        build: {
          ...cfg.build,
          watch: {},
        },
      })
    })
  )
}

async function main() {
  if (watch) {
    await watchAll()
    return
  }
  await buildAll()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
