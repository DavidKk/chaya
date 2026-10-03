#!/usr/bin/env node
/**
 * Edge 构建产物校验（在 `pnpm build:edge` 之后运行）：
 * `app/**` 下的 `*.server.*` / `*.dev.*` 路由一个都不能出现在 app-paths-manifest 里。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const APP_DIR = join(ROOT, 'app')
const MANIFEST = join(ROOT, '.next', 'server', 'app-paths-manifest.json')
const EXCLUDED_FILE = /^(page|route|layout)\.(server|dev)\.(tsx|ts|jsx|js)$/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXCLUDED_FILE.test(entry.name)) out.push(full)
  }
  return out
}

if (!existsSync(MANIFEST)) {
  console.error(`缺少 ${relative(ROOT, MANIFEST)}，请先运行 pnpm build:edge`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const builtKeys = new Set(Object.keys(manifest))
const leaked = walk(APP_DIR)
  .map((file) => {
    const rel = relative(APP_DIR, file).split(sep)
    const name = rel.pop().match(EXCLUDED_FILE)[1]
    return { file: relative(ROOT, file), key: `/${[...rel, name].join('/')}` }
  })
  .filter(({ key }) => builtKeys.has(key))

if (leaked.length) {
  console.error('Edge 构建混入了仅 server / dev 的路由：')
  for (const { file, key } of leaked) console.error(`  ${key}  ← ${file}`)
  process.exit(1)
}
console.log(`Edge 构建检查通过（${builtKeys.size} 条路由，无 *.server / *.dev 路由）`)
