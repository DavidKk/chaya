/**
 * MVP smoke (no Next server):
 * resolve bind → install shell (symlink app.nw) → check plugins / cache
 *
 * Usage:
 *   CHAYA_CONTENT=/path/to/www CHAYA_SHELL=/path/to/nwjs.app node scripts/smoke-mvp.mjs
 *
 * Optional: CHAYA_DEMO (default demos/smoke-mvp)
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

/** Prefer installed tsx/next for TS; otherwise keep a self-contained inline path. */
async function loadLibs() {
  try {
    const require = createRequire(import.meta.url)
    require.resolve('tsx/cli')
  } catch {
    // fall through to inline
  }

  // Minimal inline stand-in for lib/game-root / shell / plugins when deps are missing.
  // External callers may use node --experimental-strip-types; this file stays self-contained.
  return null
}

function looksLikeContent(dir) {
  return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'data')) && fs.existsSync(path.join(dir, 'js'))
}

function resolveGame(input) {
  let p = path.resolve(String(input).trim())
  if (!fs.existsSync(p)) return { ok: false, error: `path does not exist: ${p}` }

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
    return { ok: false, error: 'content root not found inside .app' }
  }
  if (looksLikeContent(p)) {
    const kind = path.basename(p).toLowerCase() === 'www' ? 'www' : 'content-root'
    return finish(p, p, kind)
  }
  const www = path.join(p, 'www')
  if (looksLikeContent(www)) return finish(www, p, 'www')
  return { ok: false, error: 'not recognized as RPG Maker content' }
}

function installShell({ shellSource, projectRoot, contentRoot }) {
  const dest = path.join(projectRoot, 'Chaya.app')
  const resourcesDir = path.join(dest, 'Contents/Resources')
  const appNwLink = path.join(resourcesDir, 'app.nw')

  if (projectRoot.includes(`${path.sep}Contents${path.sep}`)) {
    throw new Error('game root is inside .app/Contents; cannot install shell')
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

const REAL_CONTENT = String(process.env.CHAYA_CONTENT || '').trim()
const SHELL_SOURCE = String(process.env.CHAYA_SHELL || '').trim()
const DEMO = process.env.CHAYA_DEMO || path.join(root, 'demos/smoke-mvp')

if (!REAL_CONTENT || !SHELL_SOURCE) {
  console.error('Usage: CHAYA_CONTENT=<game content root> CHAYA_SHELL=<nwjs.app or shell source> node scripts/smoke-mvp.mjs')
  process.exit(1)
}

await loadLibs()

console.log('=== Chaya MVP smoke ===')
console.log('real content:', REAL_CONTENT)
if (!looksLikeContent(REAL_CONTENT)) {
  console.error('FAIL: invalid content root')
  process.exit(1)
}

// Standalone publish root: www → real content (symlink, no copy)
fs.mkdirSync(DEMO, { recursive: true })
const www = path.join(DEMO, 'www')
try {
  fs.rmSync(www, { recursive: true, force: true })
} catch {
  /* ignore */
}
fs.symlinkSync(REAL_CONTENT, www)

const resolved = resolveGame(DEMO)
console.log('resolve:', resolved)
if (!resolved.ok) {
  console.error('FAIL: resolve')
  process.exit(1)
}
if (resolved.projectRoot.includes(`${path.sep}Contents${path.sep}`)) {
  console.error('FAIL: still nestedInApp')
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

// Write toolkit config so the UI can pick up the smoke demo immediately
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
console.log('OK — flow: bind standalone game root → install shell → app.nw → content root')
console.log('Next: after pnpm i, run pnpm dev and use “Reveal shell in Finder” in the UI')
