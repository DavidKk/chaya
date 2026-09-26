// @ts-nocheck
import { fs, path, rt } from './env'
import { ENGINE_NAMES } from './constants'

const DEFAULT_SWITCHES = { bing: true, google: true, ollama: true }
let switchesCache = { ...DEFAULT_SWITCHES }
let switchesMtimeMs = -1
let switchesLastRead = 0
const cliSwitchOverrides = {}

export function parseCliSwitches(argv = process.argv.slice(2)) {
  for (const arg of argv) {
    if (arg === '--no-bing' || arg === '--bing=0') cliSwitchOverrides.bing = false
    if (arg === '--bing' || arg === '--bing=1') cliSwitchOverrides.bing = true
    if (arg === '--no-google' || arg === '--google=0') cliSwitchOverrides.google = false
    if (arg === '--google' || arg === '--google=1') cliSwitchOverrides.google = true
    if (arg === '--no-ollama' || arg === '--ollama=0') cliSwitchOverrides.ollama = false
    if (arg === '--ollama' || arg === '--ollama=1') cliSwitchOverrides.ollama = true
  }
  const envMap = [
    ['bing', 'BING'],
    ['google', 'GOOGLE'],
    ['ollama', 'OLLAMA'],
  ]
  for (const [key, envName] of envMap) {
    const raw = process.env[envName]
    if (raw == null || raw === '') continue
    if (/^(0|false|off|no)$/i.test(raw)) cliSwitchOverrides[key] = false
    if (/^(1|true|on|yes)$/i.test(raw)) cliSwitchOverrides[key] = true
  }
}

export function ensureSwitchesFile() {
  let base = { ...DEFAULT_SWITCHES }
  if (fs.existsSync(rt().SWITCHES_FILE)) {
    try {
      base = { ...base, ...(JSON.parse(fs.readFileSync(rt().SWITCHES_FILE, 'utf8')) || {}) }
    } catch {
      // keep defaults
    }
  }
  const next = {
    bing: base.bing !== false,
    google: base.google !== false,
    ollama: base.ollama !== false,
    ...cliSwitchOverrides,
  }
  const body = `${JSON.stringify(next, null, 2)}\n`
  const prev = fs.existsSync(rt().SWITCHES_FILE) ? fs.readFileSync(rt().SWITCHES_FILE, 'utf8') : ''
  if (prev !== body) {
    fs.writeFileSync(rt().SWITCHES_FILE, body)
    if (!prev) console.log(`已创建开关文件 ${path.basename(rt().SWITCHES_FILE)}`)
    else if (Object.keys(cliSwitchOverrides).length) {
      console.log(`已按启动参数更新 ${path.basename(rt().SWITCHES_FILE)}`)
    }
  }
  // 之后只认文件，便于运行中随时改
  for (const key of Object.keys(cliSwitchOverrides)) delete cliSwitchOverrides[key]
  switchesCache = next
  switchesMtimeMs = fs.existsSync(rt().SWITCHES_FILE) ? fs.statSync(rt().SWITCHES_FILE).mtimeMs : -1
}

export function readSwitches(force = false) {
  const now = Date.now()
  if (!force && now - switchesLastRead < 1500) return switchesCache
  switchesLastRead = now
  try {
    if (!fs.existsSync(rt().SWITCHES_FILE)) {
      switchesCache = { ...DEFAULT_SWITCHES, ...cliSwitchOverrides }
      return switchesCache
    }
    const mtimeMs = fs.statSync(rt().SWITCHES_FILE).mtimeMs
    if (!force && mtimeMs === switchesMtimeMs) return switchesCache
    switchesMtimeMs = mtimeMs
    const raw = JSON.parse(fs.readFileSync(rt().SWITCHES_FILE, 'utf8')) || {}
    switchesCache = {
      bing: raw.bing !== false,
      google: raw.google !== false,
      ollama: raw.ollama !== false,
      ...cliSwitchOverrides,
    }
  } catch (err) {
    console.warn(`[switches] 读取失败，沿用上次: ${err.message || err}`)
  }
  return switchesCache
}

export function isEngineEnabled(name) {
  const sw = readSwitches()
  return sw[name] !== false
}

export function enabledEngineNames() {
  return ENGINE_NAMES.filter((name) => isEngineEnabled(name))
}

/**
 * 按引擎记录「质检/产出失败」。仅统计当前开启的引擎：
 * 开启的引擎都失败过 → 放弃，写入 skipped，不再入队死磕。
 * 未开启的引擎不计入（例如 google 关着时，不算它失败）。
 */
export function createFailLedger() {
  /** @type {Map<string, Record<string, boolean>>} */
  const bySrc = new Map()

  if (fs.existsSync(rt().SKIPPED_NDJSON)) {
    for (const line of fs.readFileSync(rt().SKIPPED_NDJSON, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const row = JSON.parse(line)
        const src = row && (row.s || row.src)
        const engines = row && row.engines
        if (!src || !engines || typeof engines !== 'object') continue
        const cur = bySrc.get(src) || {}
        for (const [k, v] of Object.entries(engines)) {
          if (v) cur[k] = true
        }
        bySrc.set(src, cur)
      } catch {
        /* skip */
      }
    }
  }

  function hasFail(src, engine) {
    const cur = bySrc.get(src)
    return !!(cur && cur[engine])
  }

  function hasGivenUp(src) {
    const enabled = enabledEngineNames()
    if (!enabled.length) return true
    const cur = bySrc.get(src) || {}
    return enabled.every((e) => cur[e])
  }

  function noteFail(src, engine) {
    const cur = { ...(bySrc.get(src) || {}) }
    if (!cur[engine]) {
      cur[engine] = true
      bySrc.set(src, cur)
      fs.appendFileSync(rt().SKIPPED_NDJSON, `${JSON.stringify({ s: src, engines: cur, t: Date.now() })}\n`)
    } else {
      bySrc.set(src, cur)
    }
    return hasGivenUp(src)
  }

  return {
    hasFail,
    hasGivenUp,
    noteFail,
    known() {
      return bySrc.size
    },
  }
}

export function splitLines(text) {
  let body = String(text).trim()
  body = body
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
  const lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => line.trim())
}

export function parseMarked(text, count) {
  const found = new Map()
  const re = /[⟦\[【［](\d+)[⟧\]】］]\s*([^⟦\[【［]*)/g
  let match
  while ((match = re.exec(text))) {
    const index = Number(match[1])
    const value = match[2].replace(/\s+/g, ' ').trim()
    if (index < 0 || index >= count || !value || found.has(index)) continue
    found.set(index, value)
  }
  return found
}
