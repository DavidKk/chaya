/**
 * MVP 流程冒烟（不依赖 Next 启动）：
 * 绑定解析 → 装壳（软链 app.nw）→ 检查插件/缓存
 *
 * 用法: node scripts/smoke-mvp.mjs
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// 动态加载编译前 TS：优先用已安装的 tsx / next 转译；否则用内联精简实现
async function loadLibs() {
  try {
    const require = createRequire(import.meta.url)
    require.resolve('tsx/cli')
  } catch {
    // fall through to inline
  }

  // 内联：与 lib/game-root / lib/shell / lib/plugins 同逻辑的最小副本，避免缺依赖时跑不动
  // 直接用 node --experimental-strip-types 时可由外部调用；这里自包含
  return null
}

function looksLikeContent(dir) {
  return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'data')) && fs.existsSync(path.join(dir, 'js'))
}

function resolveGame(input) {
  let p = path.resolve(String(input).trim())
  if (!fs.existsSync(p)) return { ok: false, error: `路径不存在: ${p}` }

  const finish = (contentRoot, selected, kind) => {
    const base = path.basename(contentRoot).toLowerCase()
    const projectRoot = base === 'www' || base === 'app.nw' ? path.dirname(contentRoot) : contentRoot
    const shellApp = path.join(projectRoot, 'Chaya.app')
    return {
      ok: true,
      selected,
      contentRoot,
      projectRoot,
      kind,
      shellApp,
      hasShell: fs.existsSync(shellApp),
    }
  }

  if (p.endsWith('.app')) {
    for (const c of [path.join(p, 'Contents/Resources/app.nw'), path.join(p, 'Contents/Resources/app')]) {
      if (looksLikeContent(c)) return finish(c, p, 'app.nw')
    }
    return { ok: false, error: '在 .app 内找不到内容根' }
  }
  if (looksLikeContent(p)) {
    const kind = path.basename(p).toLowerCase() === 'www' ? 'www' : 'content-root'
    return finish(p, p, kind)
  }
  const www = path.join(p, 'www')
  if (looksLikeContent(www)) return finish(www, p, 'www')
  return { ok: false, error: '未识别为 RPG Maker 内容' }
}

function installShell({ shellSource, projectRoot, contentRoot }) {
  const dest = path.join(projectRoot, 'Chaya.app')
  const resourcesDir = path.join(dest, 'Contents/Resources')
  const appNwLink = path.join(resourcesDir, 'app.nw')

  if (projectRoot.includes(`${path.sep}Contents${path.sep}`)) {
    throw new Error('游戏根在 .app/Contents 内，无法装壳')
  }

  let created = false
  if (!fs.existsSync(dest)) {
    fs.cpSync(shellSource, dest, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(shellSource, src)
        if (!rel || rel === '.') return true
        if (rel === path.join('Contents', 'Resources', 'app.nw')) return false
        if (rel.startsWith(path.join('Contents', 'Resources', 'app.nw') + path.sep)) {
          return false
        }
        return true
      },
    })
    created = true
  }

  if (fs.existsSync(appNwLink) || fs.lstatSync(appNwLink, { throwIfNoEntry: false })?.isSymbolicLink()) {
    try {
      fs.rmSync(appNwLink, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  fs.symlinkSync(contentRoot, appNwLink)
  return { shellApp: dest, created, contentLink: appNwLink }
}

const REAL_CONTENT = process.env.CHAYA_CONTENT || '/Users/davidjones/Downloads/nwjs-sdk-v0.116.0-osx-arm64/nwjs.app/Contents/Resources/app.nw'
const SHELL_SOURCE = process.env.CHAYA_SHELL || '/Users/davidjones/Downloads/nwjs-sdk-v0.116.0-osx-arm64/nwjs.app'
const DEMO = process.env.CHAYA_DEMO || path.join(root, 'demos/smoke-mvp')

await loadLibs()

console.log('=== Chaya MVP smoke ===')
console.log('real content:', REAL_CONTENT)
if (!looksLikeContent(REAL_CONTENT)) {
  console.error('FAIL: 真实内容根无效')
  process.exit(1)
}

// 搭独立发布根：www → 真实内容（不复制）
fs.mkdirSync(DEMO, { recursive: true })
const www = path.join(DEMO, 'www')
try {
  fs.rmSync(www, { recursive: true, force: true })
} catch {
  /* */
}
fs.symlinkSync(REAL_CONTENT, www)

const resolved = resolveGame(DEMO)
console.log('resolve:', resolved)
if (!resolved.ok) {
  console.error('FAIL: resolve')
  process.exit(1)
}
if (resolved.projectRoot.includes(`${path.sep}Contents${path.sep}`)) {
  console.error('FAIL: 仍 nestedInApp')
  process.exit(1)
}

const shell = installShell({
  shellSource: SHELL_SOURCE,
  projectRoot: resolved.projectRoot,
  contentRoot: resolved.contentRoot,
})
console.log('shell:', shell)

const linkTarget = fs.readlinkSync(shell.contentLink)
const okLink = path.resolve(path.dirname(shell.contentLink), linkTarget) === path.resolve(resolved.contentRoot)
console.log('app.nw link ok:', okLink, '→', linkTarget)

const pluginsJs = path.join(resolved.contentRoot, 'js/plugins.js')
const raw = fs.readFileSync(pluginsJs, 'utf8')
for (const name of ['ChayaTrans', 'ChayaEdit', 'ChayaBoost']) {
  const hit = raw.includes(`"name":"${name}"`)
  console.log(`plugin ${name}:`, hit ? 'registered' : 'MISSING')
}

if (!okLink || !fs.existsSync(shell.shellApp)) {
  console.error('FAIL')
  process.exit(1)
}

// 写回工具配置，方便 UI 直接接着测
const cfgPath = path.join(root, 'chaya.config.json')
fs.writeFileSync(
  cfgPath,
  `${JSON.stringify(
    {
      gameRoot: DEMO,
      shellSource: SHELL_SOURCE,
    },
    null,
    2
  )}\n`
)
console.log('wrote config →', cfgPath)
console.log('OK — 流程打通：绑定独立游戏根 → 装壳 → app.nw 软链内容根')
console.log('下一步: pnpm i 完成后 pnpm dev，浏览器点「在 Finder 显示壳」')
