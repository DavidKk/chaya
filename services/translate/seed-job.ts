/**
 * Seed 缺词补译：服务端后台任务（刷新页面不中断）。
 * 进程内跑循环；状态落盘到 data/translate-jobs/，HMR / 重启后可恢复 running。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { TRANSLATE_JOBS_DIR } from '@/constants/paths'
import { getResolvedFromConfig } from '@/services/game/binding'

import { getTranslateEngineSwitches } from './engine-switches'
import { fillMissingFromSeed, getSeedTranslateProgress, type SeedProgress } from './fill-missing'

export type SeedJobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

export type SeedJobLogLevel = 'info' | 'ok' | 'warn' | 'fail'

export type SeedJobLogEntry = {
  id: number
  at: number
  level: SeedJobLogLevel
  text: string
}

export type SeedJobState = {
  contentRoot: string
  status: SeedJobStatus
  startedAt: number | null
  updatedAt: number
  sessionDone: number
  rounds: number
  liveStatus: string
  error: string | null
  engines: string[]
  logs: SeedJobLogEntry[]
  failedSources: string[]
}

export type SeedJobSnapshot = SeedProgress & {
  job: SeedJobState
}

const MAX_LOGS = 120
const idleJob = (contentRoot = ''): SeedJobState => ({
  contentRoot,
  status: 'idle',
  startedAt: null,
  updatedAt: Date.now(),
  sessionDone: 0,
  rounds: 0,
  liveStatus: '',
  error: null,
  engines: [],
  logs: [],
  failedSources: [],
})

type Runtime = {
  state: SeedJobState
  stopRequested: boolean
  running: boolean
  logSeq: number
}

const globalStore = globalThis as typeof globalThis & { __chayaSeedJobs?: Map<string, Runtime> }
const runtimes = (globalStore.__chayaSeedJobs ??= new Map<string, Runtime>())

function jobKey(contentRoot: string) {
  return createHash('sha1').update(path.resolve(contentRoot)).digest('hex').slice(0, 16)
}

function jobFile(contentRoot: string) {
  return path.join(TRANSLATE_JOBS_DIR, `${jobKey(contentRoot)}.json`)
}

function clip(text: string, max = 72) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function resolveBoundRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后翻译')
  return resolved.contentRoot
}

function readDisk(contentRoot: string): SeedJobState | null {
  const file = jobFile(contentRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SeedJobState>
    if (!raw || typeof raw !== 'object') return null
    return {
      ...idleJob(contentRoot),
      ...raw,
      contentRoot,
      failedSources: Array.isArray(raw.failedSources) ? raw.failedSources.filter((s): s is string => typeof s === 'string') : [],
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-MAX_LOGS) : [],
    }
  } catch {
    return null
  }
}

function writeDisk(state: SeedJobState) {
  fs.mkdirSync(TRANSLATE_JOBS_DIR, { recursive: true })
  const file = jobFile(state.contentRoot)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function getRuntime(contentRoot: string): Runtime {
  let rt = runtimes.get(contentRoot)
  if (rt) return rt
  const disk = readDisk(contentRoot)
  rt = {
    state: disk ?? idleJob(contentRoot),
    stopRequested: false,
    running: false,
    logSeq: disk?.logs.reduce((m, e) => Math.max(m, e.id), 0) ?? 0,
  }
  runtimes.set(contentRoot, rt)
  return rt
}

function pushLog(rt: Runtime, level: SeedJobLogLevel, text: string) {
  rt.logSeq += 1
  rt.state.logs = [...rt.state.logs, { id: rt.logSeq, at: Date.now(), level, text }].slice(-MAX_LOGS)
}

function persist(rt: Runtime) {
  rt.state.updatedAt = Date.now()
  writeDisk(rt.state)
}

async function runLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running) return
  rt.running = true
  rt.stopRequested = false
  try {
    while (!rt.stopRequested) {
      rt.state.liveStatus = `正在翻译第 ${rt.state.rounds + 1} 段…`
      persist(rt)
      pushLog(rt, 'info', `请求第 ${rt.state.rounds + 1} 段…`)
      persist(rt)

      let result
      try {
        result = await fillMissingFromSeed({ contentRoot, limit: 40, exclude: new Set(rt.state.failedSources) })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        rt.state.status = 'error'
        rt.state.error = msg
        rt.state.liveStatus = ''
        pushLog(rt, 'fail', msg)
        persist(rt)
        return
      }

      rt.state.rounds += 1
      rt.state.sessionDone += result.translated
      rt.state.error = null
      pushLog(
        rt,
        result.translated ? 'ok' : result.failed ? 'warn' : 'info',
        `第 ${rt.state.rounds} 段：扫描 ${result.scanned}，完成 ${result.translated}，失败 ${result.failed}，仍缺 ${result.missing}`
      )
      const samples = result.items.slice(0, 6)
      for (const it of samples) {
        if (it.zh) {
          const via = it.engine ? ` [${it.engine.replace(/^live:/, '')}]` : ''
          pushLog(rt, 'ok', `${clip(it.src)} → ${clip(it.zh)}${via}`)
        } else {
          pushLog(rt, 'warn', `${clip(it.src)}（${it.error || '未得到译文'}）`)
        }
      }
      if (result.items.length > samples.length) {
        pushLog(rt, 'info', `…另有 ${result.items.length - samples.length} 条未展开`)
      }

      if (!result.missing) {
        rt.state.status = 'done'
        rt.state.liveStatus = `已完成 · 本会话已译 ${rt.state.sessionDone} 条`
        pushLog(rt, 'ok', `已完成（需译 ${result.needCount} 条）`)
        persist(rt)
        return
      }

      const failed = result.unresolved
      rt.state.failedSources = [...new Set([...rt.state.failedSources, ...failed])]
      if (!result.scanned || (!failed.length && !result.translated)) {
        rt.state.status = 'paused'
        rt.state.liveStatus = `本轮结束 · 仍缺 ${result.missing} 条，继续可重试`
        pushLog(rt, 'warn', rt.state.liveStatus)
        persist(rt)
        return
      }
      if (failed.length) pushLog(rt, 'warn', `本轮暂跳过 ${failed.length} 条失败项，继续处理后续文本`)

      rt.state.liveStatus = `第 ${rt.state.rounds} 段完成 · 本会话已译 ${rt.state.sessionDone} 条 · 仍缺 ${result.missing}`
      persist(rt)

      if (rt.stopRequested) break
      await new Promise((resolve) => setTimeout(resolve, failed.length ? 1_000 : 25))
    }

    if (rt.stopRequested) {
      rt.state.status = 'paused'
      rt.state.liveStatus = `已暂停 · 本会话已译 ${rt.state.sessionDone} 条`
      pushLog(rt, 'warn', `已暂停（本会话已译 ${rt.state.sessionDone} 条）`)
      persist(rt)
    }
  } catch (err) {
    rt.state.status = 'error'
    rt.state.error = err instanceof Error ? err.message : String(err)
    rt.state.liveStatus = ''
    try {
      persist(rt)
    } catch {
      /* 原始落盘错误保留在内存快照中 */
    }
  } finally {
    rt.running = false
    rt.stopRequested = false
  }
}

function ensureLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running || rt.state.status !== 'running') return
  void runLoop(contentRoot)
}

/** 当前绑定游戏的进度 + 任务快照；若盘上为 running 则自动续跑循环 */
export function getSeedJobSnapshot(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const progress = getSeedTranslateProgress(contentRoot)
  const rt = getRuntime(contentRoot)
  if (rt.state.contentRoot !== contentRoot) {
    rt.state = readDisk(contentRoot) ?? idleJob(contentRoot)
  }
  if (rt.state.status === 'running' && !rt.running) {
    ensureLoop(contentRoot)
  }
  return { ...progress, job: { ...rt.state, logs: [...rt.state.logs] } }
}

/** 启动或继续补译（服务端循环） */
export function startSeedJob(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  // 操作入口必须看到刚导入的 seed / 刚清除的缓存，不能复用轮询的旧进度。
  const progress = getSeedTranslateProgress(contentRoot, true)
  if (!progress.hasSeed || !progress.total) {
    throw new Error('未找到 seed（请先抽取文本，或放入 *-trans.seed.json）')
  }
  if (!progress.missing) {
    const rt = getRuntime(contentRoot)
    rt.state.status = 'done'
    rt.state.liveStatus = '已完成'
    rt.state.error = null
    persist(rt)
    return { ...progress, job: { ...rt.state, logs: [...rt.state.logs] } }
  }

  let engines: string[] = []
  try {
    engines = getTranslateEngineSwitches(contentRoot).enabled
  } catch {
    engines = []
  }
  if (!engines.length) throw new Error('未开启任何翻译平台')

  const rt = getRuntime(contentRoot)
  if (rt.running) return { ...progress, job: { ...rt.state, logs: [...rt.state.logs] } }
  rt.state.failedSources = []
  const resume = rt.state.status === 'paused' || rt.state.status === 'running'
  rt.stopRequested = false
  rt.state.contentRoot = contentRoot
  rt.state.status = 'running'
  rt.state.startedAt = resume && rt.state.startedAt ? rt.state.startedAt : Date.now()
  rt.state.error = null
  rt.state.engines = engines
  rt.state.liveStatus = resume ? '继续翻译…' : '开始翻译…'
  if (!resume) {
    rt.state.sessionDone = 0
    rt.state.rounds = 0
    rt.state.logs = []
    rt.logSeq = 0
  }
  pushLog(rt, 'info', `${resume ? '继续' : '开始'}翻译（引擎 ${engines.join(' → ')}）`)
  persist(rt)
  ensureLoop(contentRoot)
  return { ...getSeedTranslateProgress(contentRoot), job: { ...rt.state, logs: [...rt.state.logs] } }
}

/** 暂停：当前段结束后停下 */
export function pauseSeedJob(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const rt = getRuntime(contentRoot)
  if (rt.state.status !== 'running') {
    return getSeedJobSnapshot()
  }
  rt.stopRequested = true
  rt.state.liveStatus = '正在暂停…'
  pushLog(rt, 'warn', '收到暂停请求，将在当前段结束后停下')
  persist(rt)
  return { ...getSeedTranslateProgress(contentRoot), job: { ...rt.state, logs: [...rt.state.logs] } }
}
