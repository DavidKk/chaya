import fs from 'node:fs'
import path from 'node:path'

import { ROOT_PATH } from '@/constants/paths'
import { TRACKED_PLUGINS } from '@/lib/game'

import { resolveKitPluginSource } from './plugins'

export type PluginHotChange = { name: string; etag: string; ts: number }

type Listener = (change: PluginHotChange) => void

const listeners = new Set<Listener>()
const debounce = new Map<string, ReturnType<typeof setTimeout>>()
const ALLOWED = new Set<string>(TRACKED_PLUGINS)

let watcher: fs.FSWatcher | null = null
let watchingDir: string | null = null
let retry: ReturnType<typeof setInterval> | null = null

function pluginDistDir() {
  return path.join(ROOT_PATH, 'plugins/dist')
}

function etagFor(file: string) {
  const st = fs.statSync(file)
  return `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`
}

export function pluginHotSnapshot(): PluginHotChange[] {
  return TRACKED_PLUGINS.flatMap((name) => {
    try {
      const file = resolveKitPluginSource(name)
      return file ? [{ name, etag: etagFor(file), ts: Date.now() }] : []
    } catch {
      return []
    }
  })
}

function emitName(name: string) {
  if (!ALLOWED.has(name)) return
  const src = resolveKitPluginSource(name)
  if (!src || !fs.existsSync(src)) return
  let etag: string
  try {
    etag = etagFor(src)
  } catch {
    return
  }
  const change: PluginHotChange = { name, etag, ts: Date.now() }
  for (const fn of listeners) {
    try {
      fn(change)
    } catch {
      /* */
    }
  }
}

function schedule(filename: string | null) {
  if (!filename) {
    for (const name of TRACKED_PLUGINS) schedule(`${name}.js`)
    return
  }
  if (!/\.js$/i.test(filename)) return
  const name = path.basename(filename).replace(/\.js$/i, '')
  if (!ALLOWED.has(name)) return
  const prev = debounce.get(name)
  if (prev) clearTimeout(prev)
  debounce.set(
    name,
    setTimeout(() => {
      debounce.delete(name)
      emitName(name)
    }, 100)
  )
}

function ensureWatch() {
  const dir = pluginDistDir()
  if (watcher && watchingDir === dir) return
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* */
    }
    watcher = null
    watchingDir = null
  }
  if (!fs.existsSync(dir)) return
  try {
    watcher = fs.watch(dir, { persistent: true }, (_event, filename) => {
      schedule(filename ? String(filename) : null)
    })
    watchingDir = dir
  } catch {
    watcher = null
    watchingDir = null
  }
}

/** 订阅 plugins/dist 变更（Vite watch 写出后推给 SSE / 热替换） */
export function subscribePluginHot(fn: Listener): () => void {
  ensureWatch()
  listeners.add(fn)
  if (!watcher && !retry) {
    retry = setInterval(() => {
      ensureWatch()
      if (watcher && retry) {
        clearInterval(retry)
        retry = null
      }
    }, 3_000)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size) {
      watcher?.close()
      watcher = null
      watchingDir = null
      if (retry) clearInterval(retry)
      retry = null
      for (const timer of debounce.values()) clearTimeout(timer)
      debounce.clear()
    }
  }
}
