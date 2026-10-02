/**
 * ChayaLoader — thin loader: disk cache → local URL → local API.
 * Development services enable SSE hot replacement after the initial disk load.
 */

import { PLUGIN_AGENT_NAME, PLUGIN_BOOST_NAME, PLUGIN_EDIT_NAME, PLUGIN_RUNTIME_NAME, PLUGIN_TRANS_NAME } from '@/constants/brand'

import { ensureLaunchEnvGlobals, pinApiBaseFromUrl, resolveApiBase, resolveApiBaseFallbacks, restorePluginErrors, showPluginError } from './helpers'
import { tryNodeFsPath } from './helpers/node/node-require'

declare const PluginManager: { setParameters?: (name: string, params: Record<string, string>) => void } | undefined

const LOAD_ORDER = [PLUGIN_RUNTIME_NAME, PLUGIN_TRANS_NAME, PLUGIN_BOOST_NAME, PLUGIN_EDIT_NAME, PLUGIN_AGENT_NAME] as const

type LoadFail = { name: string; reason: string }

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

function fileUrlToPath(url: string): string | null {
  try {
    if (!/^file:/i.test(url)) return null
    let p = decodeURIComponent(url.replace(/^file:\/\//i, ''))
    // file:///C:/... → C:/...
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    return p
  } catch {
    return null
  }
}

/** Infer plugins dir from the Loader script src */
function pluginsDirFromScripts(pathMod: typeof import('path')): string | null {
  try {
    const scripts = document.getElementsByTagName('script')
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i]?.src || ''
      if (!src) continue
      if (!/ChayaLoader\.js/i.test(src) && !/\/js\/plugins\//i.test(src)) continue
      const filePath = fileUrlToPath(src)
      if (filePath) return pathMod.dirname(filePath)
      // Relative path: relative to the current page
      try {
        const abs = new URL(src, window.location.href).href
        const p = fileUrlToPath(abs)
        if (p) return pathMod.dirname(p)
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
  return null
}

function pluginDiskCandidates(name: string): string[] {
  const mods = tryNodeFsPath()
  if (!mods) return []
  const { fs, path } = mods
  const fileName = `${name}.js`
  const candidates: string[] = []
  const push = (dir: string | null | undefined) => {
    if (!dir) return
    candidates.push(path.join(dir, fileName))
  }

  push(pluginsDirFromScripts(path))

  try {
    const href = String(window.location?.href || '')
    const pagePath = fileUrlToPath(href)
    if (pagePath) push(path.join(path.dirname(pagePath), 'js', 'plugins'))
  } catch {
    /* */
  }

  try {
    if (typeof process !== 'undefined' && process.cwd) {
      push(path.join(process.cwd(), 'js', 'plugins'))
    }
  } catch {
    /* */
  }

  try {
    const nwApp = (globalThis as { nw?: { App?: { startPath?: string } } }).nw?.App
    if (nwApp?.startPath) {
      push(path.join(nwApp.startPath, 'js', 'plugins'))
      push(path.join(path.dirname(nwApp.startPath), 'js', 'plugins'))
    }
  } catch {
    /* */
  }

  try {
    if (typeof process !== 'undefined' && process.execPath) {
      const macOs = path.dirname(process.execPath)
      const resources = path.resolve(macOs, '..', 'Resources')
      for (const pack of ['app.nw', 'app', 'package.nw']) {
        push(path.join(resources, pack, 'js', 'plugins'))
      }
    }
  } catch {
    /* */
  }

  try {
    const argv = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : []
    for (const arg of argv) {
      if (!arg || arg.startsWith('-')) continue
      if (fs.existsSync(path.join(arg, 'js', 'plugins'))) push(path.join(arg, 'js', 'plugins'))
      if (fs.existsSync(path.join(arg, 'Contents', 'Resources', 'app.nw', 'js', 'plugins'))) {
        push(path.join(arg, 'Contents', 'Resources', 'app.nw', 'js', 'plugins'))
      }
    }
  } catch {
    /* */
  }

  return candidates
}

function readDiskViaNode(name: string): { code: string; from: string } | null {
  const mods = tryNodeFsPath()
  if (!mods) return null
  const { fs } = mods
  for (const file of pluginDiskCandidates(name)) {
    try {
      if (fs.existsSync(file)) return { code: fs.readFileSync(file, 'utf8'), from: file }
    } catch {
      /* */
    }
  }
  return null
}

/** Relative / file URL → prefer fs; avoid sync XHR failing on large files */
function readLocalUrlViaNode(url: string): { code: string; from: string } | null {
  const mods = tryNodeFsPath()
  if (!mods) return null
  const { fs, path } = mods
  try {
    let file = fileUrlToPath(url)
    if (!file && !/^https?:/i.test(url)) {
      const page = fileUrlToPath(String(window.location?.href || ''))
      if (page) file = path.resolve(path.dirname(page), url)
      else if (typeof process !== 'undefined' && process.cwd) file = path.resolve(process.cwd(), url)
    }
    if (!file) return null
    if (fs.existsSync(file)) return { code: fs.readFileSync(file, 'utf8'), from: file }
  } catch {
    /* */
  }
  return null
}

function localPluginUrls(name: string): string[] {
  const urls: string[] = []
  const fileName = `${name}.js`
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

function runCode(code: string, name: string) {
  try {
    PluginManager?.setParameters?.(name, {})
  } catch {
    /* */
  }
  ;(0, eval)(code)
}

function apiUrls(name: string): string[] {
  const urls: string[] = []
  for (const base of resolveApiBaseFallbacks()) {
    urls.push(`${base.replace(/\/$/, '')}/api/plugins/${encodeURIComponent(name)}.js`)
  }
  return urls
}

function tryRunCode(name: string, code: string, from: string): string | null {
  try {
    runCode(code, name)
    try {
      console.info(`[ChayaLoader] ${name} ← ${from}`)
    } catch {
      /* */
    }
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      console.error(`[ChayaLoader] 执行失败 ${name} ← ${from}`, err)
    } catch {
      /* */
    }
    return msg
  }
}

function loadOne(name: (typeof LOAD_ORDER)[number]): LoadFail | null {
  const errors: string[] = []

  const disk = readDiskViaNode(name)
  if (disk) {
    const err = tryRunCode(name, disk.code, disk.from)
    if (!err) return null
    errors.push(`disk(${disk.from}): ${err}`)
  } else {
    errors.push('disk: 未找到文件')
  }

  for (const url of localPluginUrls(name)) {
    const viaNode = readLocalUrlViaNode(url)
    if (viaNode) {
      const err = tryRunCode(name, viaNode.code, viaNode.from)
      if (!err) return null
      errors.push(`local-fs(${viaNode.from}): ${err}`)
      continue
    }
    if (/^https?:/i.test(url)) continue
    const code = syncGet(url)
    if (!code) {
      errors.push(`xhr(${url}): 空响应`)
      continue
    }
    const err = tryRunCode(name, code, url)
    if (!err) return null
    errors.push(`xhr(${url}): ${err}`)
  }

  for (const url of apiUrls(name)) {
    const code = syncGet(url)
    if (!code) {
      errors.push(`api(${url}): 不可达`)
      continue
    }
    const err = tryRunCode(name, code, url)
    if (!err) {
      // 远程拉取成功：后续心跳 / 翻译跟这个 origin（域名或局域网 IP）
      pinApiBaseFromUrl(url)
      return null
    }
    errors.push(`api(${url}): ${err}`)
  }

  try {
    console.warn(`[ChayaLoader] 未能加载 ${name}（api=${resolveApiBase()}）`, errors)
  } catch {
    /* */
  }
  return { name, reason: errors.join('\n') }
}

function startHotReload() {
  const g = globalThis as typeof globalThis & { __chayaLoaderHot?: boolean }
  if (g.__chayaLoaderHot || typeof EventSource === 'undefined') return
  g.__chayaLoaderHot = true
  const order = new Set<string>(LOAD_ORDER)
  const applied = new Map<string, string>()
  const pending = new Map<string, string>()
  const lifetime = new AbortController()
  let es: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let drainTimer: ReturnType<typeof setTimeout> | null = null
  let activeBase = ''
  let draining = false

  async function fetchDev(url: string, method = 'GET') {
    const abort = new AbortController()
    const cancel = () => abort.abort()
    lifetime.signal.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(cancel, 5000)
    try {
      if (lifetime.signal.aborted) abort.abort()
      const response = await fetch(url, { method, cache: 'no-store', signal: abort.signal })
      // Keep the deadline active while reading the script, not just its headers.
      const code = method === 'GET' && response.ok ? await response.text() : ''
      return { response, code }
    } finally {
      clearTimeout(timeout)
      lifetime.signal.removeEventListener('abort', cancel)
    }
  }

  async function drain() {
    if (draining || !es || lifetime.signal.aborted) return
    draining = true
    let failed = false
    try {
      while (pending.size && !lifetime.signal.aborted && !failed) {
        for (const name of LOAD_ORDER) {
          const requested = pending.get(name)
          if (!requested) continue
          pending.delete(name)
          if (applied.get(name) === requested) continue
          const source: EventSource | null = es
          if (!source) {
            pending.set(name, requested)
            return
          }
          const url = `${activeBase}/api/plugins/${encodeURIComponent(name)}.js`
          try {
            const { response, code } = await fetchDev(url)
            if (!response.ok || !code) throw new Error(`HTTP ${response.status}`)
            if (lifetime.signal.aborted) return
            if (es !== source) {
              if (!pending.has(name)) pending.set(name, requested)
              failed = true
              break
            }
            const etag = response.headers.get('ETag') || requested
            if (applied.get(name) !== etag) {
              ensureLaunchEnvGlobals()
              runCode(code, name)
              pinApiBaseFromUrl(url)
              applied.set(name, etag)
              console.info(`[ChayaLoader] hot ${name} ← ${url}`)
            }
            if (pending.get(name) === etag) pending.delete(name)
          } catch (error) {
            if (lifetime.signal.aborted) return
            // Preserve the newest event; a transient build/write failure must not lose an update.
            if (!pending.has(name)) pending.set(name, requested)
            console.warn(`[ChayaLoader] 热替换暂未完成，稍后重试 ${name}`, error)
            failed = true
            break
          }
        }
      }
    } finally {
      draining = false
      if (failed && !lifetime.signal.aborted)
        drainTimer = setTimeout(() => {
          drainTimer = null
          void drain()
        }, 2000)
    }
  }

  function enqueue(changes: unknown[]) {
    for (const item of changes) {
      if (!item || typeof item !== 'object') continue
      const { name, etag } = item as { name?: unknown; etag?: unknown }
      if (typeof name === 'string' && order.has(name) && typeof etag === 'string' && etag) pending.set(name, etag)
    }
    if (!drainTimer) void drain()
  }

  async function connect() {
    if (lifetime.signal.aborted) return
    es?.close()
    es = null
    let unavailable = false
    for (const base of resolveApiBaseFallbacks()) {
      const url = `${base.replace(/\/$/, '')}/api/plugins/stream`
      try {
        // Installed release loaders also opt in, but only with an explicit development service.
        const { response } = await fetchDev(url, 'HEAD')
        if (lifetime.signal.aborted) return
        if (!response.ok) {
          unavailable = true
          continue
        }
        if (response.headers.get('X-Chaya-Plugin-Dev') !== '1') continue
        activeBase = base.replace(/\/$/, '')
        const source = new EventSource(url)
        es = source
        source.addEventListener('hello', (ev) => {
          if (es !== source) return
          try {
            const data = JSON.parse(String((ev as MessageEvent).data || '{}'))
            if (Array.isArray(data.plugins)) enqueue(data.plugins)
            console.info(`[ChayaLoader] 开发热替换 SSE 已连接 ← ${url}`)
          } catch {
            /* Ignore invalid events. */
          }
        })
        source.addEventListener('change', (ev) => {
          if (es !== source) return
          try {
            enqueue([JSON.parse(String((ev as MessageEvent).data || '{}'))])
          } catch {
            /* Ignore invalid events. */
          }
        })
        source.onerror = () => {
          if (es !== source) return
          source.close()
          es = null
          retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
          }, 2000)
        }
        return
      } catch {
        unavailable = true
      }
    }
    // A game may start before its dev server. Retry unavailable services; production replies stop discovery.
    if (unavailable && !lifetime.signal.aborted)
      retryTimer = setTimeout(() => {
        retryTimer = null
        void connect()
      }, 5000)
  }

  window.addEventListener(
    'beforeunload',
    () => {
      lifetime.abort()
      es?.close()
      if (retryTimer) clearTimeout(retryTimer)
      if (drainTimer) clearTimeout(drainTimer)
      pending.clear()
    },
    { once: true }
  )
  void connect()
}

try {
  ensureLaunchEnvGlobals()
  const failed: LoadFail[] = []
  for (const name of LOAD_ORDER) {
    try {
      const fail = loadOne(name)
      if (fail) failed.push(fail)
    } catch (err) {
      failed.push({ name, reason: err instanceof Error ? err.message : String(err) })
      try {
        console.error(`[ChayaLoader] 加载中断 ${name}`, err)
      } catch {
        /* */
      }
    }
  }
  if (failed.length) {
    showPluginError(
      '部分 Chaya 插件未能加载',
      failed.map((f) => `· ${f.name}\n${f.reason}`).join('\n\n') + '\n\n请确认已 pnpm build:plugins，并在控制台重新「安装插件」后重启游戏。'
    )
  }
  void startHotReload()
  restorePluginErrors()
} catch (err) {
  try {
    console.error('[ChayaLoader] 启动失败（已隔离，不影响游戏本体）', err)
  } catch {
    /* */
  }
  showPluginError('ChayaLoader 启动失败', err)
}
