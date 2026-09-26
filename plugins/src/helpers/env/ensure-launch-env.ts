/**
 * Ensure window has CHAYA_GAME_ID / LAUNCH_TOKEN.
 * On PluginManager races, HMR, or late Env writes, re-run ChayaEnv from disk / relative URL.
 */

import { PLUGIN_ENV_NAME } from '@/constants/brand'

function hasLaunchGlobals(): boolean {
  try {
    const w = window as Window & { CHAYA_GAME_ID?: string; CHAYA_LAUNCH_TOKEN?: string }
    return !!(String(w.CHAYA_GAME_ID || '').trim() || String(w.CHAYA_LAUNCH_TOKEN || '').trim())
  } catch {
    return false
  }
}

function syncGet(url: string): string | null {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, false)
    xhr.send(null)
    const ok = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)
    if (!ok) return null
    const text = String(xhr.responseText || '')
    return text ? text : null
  } catch {
    return null
  }
}

function localEnvUrls(): string[] {
  const fileName = `${PLUGIN_ENV_NAME}.js`
  const urls: string[] = []
  try {
    const scripts = document.getElementsByTagName('script')
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i]?.src || ''
      if (!src) continue
      if (/ChayaLoader\.js/i.test(src) || /\/js\/plugins\//i.test(src)) {
        urls.push(src.replace(/[^/]+$/, fileName))
        break
      }
    }
  } catch {
    /* */
  }
  urls.push(`js/plugins/${fileName}`)
  return urls
}

function readEnvFromDisk(): string | null {
  try {
    const req = (globalThis as { require?: NodeRequire }).require
    if (typeof req !== 'function') return null
    const fs = req('fs') as typeof import('fs')
    const path = req('path') as typeof import('path')
    const candidates: string[] = []
    const fileName = `${PLUGIN_ENV_NAME}.js`

    try {
      const href = String(window.location?.href || '')
      if (href.startsWith('file:')) {
        const raw = decodeURIComponent(href.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'))
        const dir = path.dirname(raw)
        candidates.push(path.join(dir, 'js', 'plugins', fileName))
      }
    } catch {
      /* */
    }

    try {
      if (typeof process !== 'undefined' && process.cwd) {
        candidates.push(path.join(process.cwd(), 'js', 'plugins', fileName))
      }
    } catch {
      /* */
    }

    // NW macOS：execPath = ….app/Contents/MacOS/nwjs → Resources/app.nw
    try {
      if (typeof process !== 'undefined' && process.execPath) {
        const macOs = path.dirname(process.execPath)
        const resources = path.resolve(macOs, '..', 'Resources')
        for (const pack of ['app.nw', 'app', 'package.nw']) {
          candidates.push(path.join(resources, pack, 'js', 'plugins', fileName))
        }
      }
    } catch {
      /* */
    }

    // Content root from launch args (open -n shell --args <contentRoot>)
    try {
      const argv = (typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : []) as string[]
      for (const arg of argv) {
        if (!arg || arg.startsWith('-')) continue
        if (fs.existsSync(path.join(arg, 'js', 'plugins'))) {
          candidates.push(path.join(arg, 'js', 'plugins', fileName))
        }
      }
    } catch {
      /* */
    }

    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
      } catch {
        /* */
      }
    }
    return null
  } catch {
    return null
  }
}

function runEnvCode(code: string) {
  try {
    ;(0, eval)(code)
  } catch {
    /* */
  }
}

/** If room id is missing, try re-running ChayaEnv; returns whether launch globals exist */
export function ensureLaunchEnvGlobals(): boolean {
  if (hasLaunchGlobals()) return true

  const disk = readEnvFromDisk()
  if (disk) {
    runEnvCode(disk)
    if (hasLaunchGlobals()) {
      try {
        console.info(`[Chaya] 已补跑 ${PLUGIN_ENV_NAME}（此前未注入房间 id）`)
      } catch {
        /* */
      }
      return true
    }
  }

  for (const u of localEnvUrls()) {
    const text = syncGet(u)
    if (!text) continue
    runEnvCode(text)
    if (hasLaunchGlobals()) {
      try {
        console.info(`[Chaya] 已补跑 ${PLUGIN_ENV_NAME} ← ${u}`)
      } catch {
        /* */
      }
      return true
    }
  }

  return hasLaunchGlobals()
}
