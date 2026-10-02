/**
 * ChayaTrans — cached translations plus optional local-model dialogue translation.
 */
/// <reference types="node" />
import { gameContentRelPath, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { peelChoiceMetaTrail } from '@/lib/translate/choice-meta'
import { isStorableTranslation } from '@/services/translate/text-classify'

import { createLogger, detectGameIdentity, tryNodeFsPath } from '../helpers'
import { hookMethod } from '../helpers/game/method-hook'
import { declarePluginTools } from '../helpers/plugin-tools'
import { installDialogueSubtitles } from './engine/dialogue-subtitles'
import { installEngineHooks } from './engine/engine-hooks'
import { createRealtimeClient } from './engine/realtime-client'
import { installSubtitleOverlay } from './engine/subtitle-overlay'
import { createLookupEnrichment } from './lookup/lookup-enrich'
import { createTransCatchUp } from './patch/apply-queue'
import { patchDatabaseTexts, patchMapTexts } from './patch/db-patch'

const log = createLogger('ChayaTrans')

type TransLookup = Record<string, string>
type CacheCandidate = { file: string; kind: 'ndjson' }

function errMsg(err: unknown): unknown {
  return err instanceof Error ? err.message : err
}

function main() {
  const hot = window as Window & { __chayaTransDispose?: () => void; __chayaDialogueCleanup?: () => void; __chayaSubtitleCleanup?: () => void }
  hot.__chayaTransDispose?.()
  const mods = tryNodeFsPath()
  if (!mods) {
    log.fail('需要 Node fs（NW / Electron）')
    return
  }
  const { fs, path } = mods

  const identity = detectGameIdentity()
  const contentRoots = identity?.contentRoot ? [identity.contentRoot] : [process.cwd(), path.join(process.cwd(), 'www')].filter(Boolean)

  const POLL_MS = 2000
  const cacheRel = gameContentRelPath('cacheNdjson')
  const seedRel = gameContentRelPath('seed')

  const candidates: CacheCandidate[] = []
  const seedCandidates: string[] = []
  for (const root of contentRoots) {
    candidates.push({ file: path.join(root, cacheRel), kind: 'ndjson' })
    seedCandidates.push(path.join(root, seedRel))
    for (const name of LEGACY_FLAT_FILES.cacheNdjson) {
      candidates.push({ file: path.join(root, name), kind: 'ndjson' })
    }
    for (const name of LEGACY_FLAT_FILES.seed) {
      seedCandidates.push(path.join(root, name))
    }
  }

  function normalizeKey(text: unknown): string {
    let s = String(text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
    s = s.replace(/^"+/, '').replace(/("\);|"\))$/, '')
    try {
      s = s.normalize('NFKC')
    } catch {
      /* */
    }
    return s
  }

  const enrich = createLookupEnrichment()

  function applyPair(lookup: TransLookup, src: unknown, zh: unknown) {
    const k = String(src)
    const v = String(zh)
    if (!isStorableTranslation(k, v)) return
    lookup[k] = v
    const nk = normalizeKey(k)
    if (nk) lookup[nk] = v
    enrich.notePair(k, v, lookup)
  }

  function parseNdjsonChunk(text: string, lookup: TransLookup): number {
    let added = 0
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const row = JSON.parse(line) as unknown
        if (Array.isArray(row) && row.length >= 2 && row[0] != null && row[1] != null) {
          applyPair(lookup, row[0], row[1])
          added += 1
        } else if (row && typeof row === 'object' && 's' in row && 't' in row) {
          const rec = row as { s: unknown; t: unknown }
          if (typeof rec.s === 'string' && rec.t === null) {
            delete lookup[rec.s]
            delete lookup[normalizeKey(rec.s)]
            enrich.reindexAll(lookup)
            added += 1
          } else if (rec.s != null && rec.t != null) {
            applyPair(lookup, rec.s, rec.t)
            added += 1
          }
        }
      } catch {
        // skip bad / incomplete trailing line
      }
    }
    return added
  }

  /** 只消费完整行；兼容历史上没有末尾换行的完整 JSON 行。 */
  function completeNdjsonChunk(text: string): { text: string; bytes: number } {
    const lastNewline = text.lastIndexOf('\n')
    const tail = text.slice(lastNewline + 1)
    if (tail.trim()) {
      try {
        JSON.parse(tail)
        return { text, bytes: Buffer.byteLength(text, 'utf8') }
      } catch {
        // 写入中的半行下次连同后续字节一起读取。
      }
    }
    const complete = text.slice(0, lastNewline + 1)
    return { text: complete, bytes: Buffer.byteLength(complete, 'utf8') }
  }

  function loadNdjsonFull(file: string, lookup = Object.create(null) as TransLookup) {
    const text = fs.readFileSync(file, 'utf8')
    const complete = completeNdjsonChunk(text)
    parseNdjsonChunk(complete.text, lookup)
    return { lookup, bytes: complete.bytes }
  }

  function loadJsonObject(file: string): TransLookup {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('不是对象格式的翻译表')
    }
    const lookup = Object.create(null) as TransLookup
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null || !String(v) || String(k) === String(v)) continue
      applyPair(lookup, k, v)
    }
    return lookup
  }

  let found: CacheCandidate | undefined = candidates.find((item) => fs.existsSync(item.file))
  if (!found) {
    const root = contentRoots[0] || process.cwd()
    const createAt = path.join(root, cacheRel)
    try {
      fs.mkdirSync(path.dirname(createAt), { recursive: true })
      fs.writeFileSync(createAt, '', 'utf8')
      found = { file: createAt, kind: 'ndjson' }
      log.ok(`已创建本作翻译库 → ${createAt}`)
    } catch (err) {
      log.fail(`无法创建本作翻译库 ${createAt}`, errMsg(err))
      return
    }
  }
  const cacheFile = found

  let lookup = Object.create(null) as TransLookup
  let fileSize = 0
  let fileMtimeMs = 0
  let seedFile: string | undefined
  let seedMtimeMs = 0
  let entryCount = 0

  function fullReload(reason?: string): boolean {
    try {
      seedFile = seedCandidates.find((file) => fs.existsSync(file))
      seedMtimeMs = seedFile ? fs.statSync(seedFile).mtimeMs : 0
      lookup = Object.create(null) as TransLookup
      if (seedFile) {
        try {
          lookup = loadJsonObject(seedFile)
        } catch (err) {
          seedMtimeMs = 0
          log.warn('原文表暂不可读，继续加载增量译文', errMsg(err))
        }
      }
      const loaded = loadNdjsonFull(cacheFile.file, lookup)
      lookup = loaded.lookup
      fileSize = loaded.bytes
      fileMtimeMs = fs.statSync(cacheFile.file).mtimeMs
      entryCount = Object.keys(lookup).length
      enrich.reindexAll(lookup)
      publishTransGlobals()
      log.ok(`${reason || '加载'} 本作翻译库（${entryCount} 条；词干 ${enrich.stemCount} / 模板 ${enrich.templateCount}）`)
      return true
    } catch (err) {
      log.fail('读取失败: ' + cacheFile.file, errMsg(err))
      return false
    }
  }

  /** After lookup updates, schedule patch apply; chunked in apply-queue so HMR does not scan the whole DB */
  let scheduleCatchUp = () => {}
  let scheduleWindowRefresh = () => {}

  /** NDJSON append: read only new bytes; later writes overwrite the same key */
  function appendReload(): boolean {
    const currentSeed = seedCandidates.find((file) => fs.existsSync(file))
    if (currentSeed !== seedFile || (currentSeed && fs.statSync(currentSeed).mtimeMs !== seedMtimeMs)) {
      const loaded = fullReload('原文表更新')
      if (loaded) {
        if (typeof DataManager !== 'undefined' && DataManager._chayaTransDbPatched) scheduleCatchUp()
        scheduleWindowRefresh()
      }
      return loaded
    }
    let st: import('fs').Stats
    try {
      st = fs.statSync(cacheFile.file)
    } catch (err) {
      log.warn('热更新失败', errMsg(err))
      return false
    }
    if (st.size < fileSize) {
      return fullReload('文件缩短，全量重载')
    }
    if (st.size === fileSize && st.mtimeMs === fileMtimeMs) return false

    const grow = st.size - fileSize
    if (grow <= 0) {
      fileMtimeMs = st.mtimeMs
      return false
    }

    let added = 0
    try {
      const fd = fs.openSync(cacheFile.file, 'r')
      try {
        const buf = Buffer.alloc(grow)
        fs.readSync(fd, buf, 0, grow, fileSize)
        const complete = completeNdjsonChunk(buf.toString('utf8'))
        added = parseNdjsonChunk(complete.text, lookup)
        fileSize += complete.bytes
      } finally {
        fs.closeSync(fd)
      }
    } catch (err) {
      log.warn('增量读取失败，改为全量', errMsg(err))
      return fullReload('增量失败后全量')
    }

    fileMtimeMs = st.mtimeMs
    entryCount = Object.keys(lookup).length
    publishTransGlobals()
    if (added) {
      log.ok(`热更新 +${added} 行写入，当前约 ${entryCount} 条`)
      // Lookup is fresh; draw hooks use it immediately; DB write-back is chunked to avoid blocking the game thread
      if (typeof DataManager !== 'undefined' && DataManager._chayaTransDbPatched) scheduleCatchUp()
      scheduleWindowRefresh()
    }
    return added > 0
  }

  if (!fullReload('已加载')) return

  const realtime = createRealtimeClient(contentRoots[0])
  let translating = false

  function translate(text: unknown): string {
    if (text == null || text === '') return text as string
    const raw = String(text)
    const { core: peeled, trail: metaTrail } = peelChoiceMetaTrail(raw)
    const body = peeled.length ? peeled : raw

    function finish(zh: string) {
      return metaTrail ? zh + metaTrail : zh
    }

    // Exact + control-code segments + trailing-number family + proper-name templates
    const hitBody = enrich.resolve(lookup, body)
    if (hitBody != null) return finish(hitBody)

    if (body.indexOf('\n') >= 0) {
      const lines = body.split('\n')
      let any = false
      const out = lines.map((line) => {
        const { core: lineCore, trail: lineMeta } = peelChoiceMetaTrail(line)
        const key = lineCore.length ? lineCore : line
        const zh = enrich.resolve(lookup, key)
        if (zh != null) {
          any = true
          return lineMeta ? zh + lineMeta : zh
        }
        return line
      })
      if (any) return finish(out.join('\n'))
      return raw
    }

    // Whole-sentence poison cache: with meta, do not echo short false-positive glosses (e.g. if/enable)
    if (!metaTrail) {
      const hitRaw = enrich.resolve(lookup, raw)
      if (hitRaw != null) return hitRaw
    }

    return raw
  }

  function publishTransGlobals() {
    window._chayaTransRaw = lookup
    window._chayaTransSource = cacheFile.file
    window._chayaTransCount = entryCount
    window._chayaTranslate = translate
    window._chayaTransReload = () => fullReload('手动重载')
    window._chayaTransStatus = () => ({
      file: cacheFile.file,
      entries: entryCount,
      kind: cacheFile.kind,
      remoteOnline: realtime.remoteOnline(),
      translating,
      playMode: realtime.settings().mode,
    })
    window.ChayaTrans = {
      translate,
      reload: () => fullReload('手动重载'),
      status: () => ({
        file: cacheFile.file,
        entries: entryCount,
        kind: cacheFile.kind,
        remoteOnline: realtime.remoteOnline(),
        translating,
        playMode: realtime.settings().mode,
      }),
      get raw() {
        return lookup
      },
      get source() {
        return cacheFile.file
      },
      get count() {
        return entryCount
      },
    }
  }
  publishTransGlobals()
  declarePluginTools('ChayaTrans', {
    status: () => window.ChayaTrans?.status(),
    reload: async () => {
      await window.ChayaTrans?.reload()
      return window.ChayaTrans?.status()
    },
  })

  const sampleKeys = ['ワールド移動', '休憩する', '夜まで休む']
  sampleKeys.forEach((k) => {
    log.info(`Key [${k}] => ${lookup[k]}`)
  })

  // Poll + fs.watch: coalesce into one incremental read to avoid rescanning during write storms
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleReload() {
    if (reloadTimer) return
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      try {
        appendReload()
      } catch (err) {
        log.warn('热更新异常', errMsg(err))
      }
    }, 400)
  }

  const poll = setInterval(() => {
    scheduleReload()
  }, POLL_MS)

  let watcher: import('fs').FSWatcher | null = null
  try {
    watcher = fs.watch(cacheFile.file, { persistent: false }, () => {
      scheduleReload()
    })
    log.ok(`已开启热更新（轮询 ${POLL_MS / 1000}s + watch）→ ${cacheFile.file}`)
  } catch (err) {
    log.warn('fs.watch 不可用，仅用轮询', errMsg(err))
  }

  const catchUp = createTransCatchUp({
    translate: (text) => translate(text),
    log,
    preserveDialogue: true,
  })
  scheduleCatchUp = catchUp.scheduleCatchUp
  scheduleWindowRefresh = catchUp.scheduleWindowRefresh

  const removeEngineHooks = installEngineHooks(translate, () => realtime.settings().mode)
  const showSubtitle = installSubtitleOverlay()
  installDialogueSubtitles({
    settings: realtime.settings,
    cached: translate,
    show: showSubtitle,
    request: async (texts, signal) => {
      try {
        const items = await realtime.request(texts, signal)
        for (const item of items) if (item.zh) applyPair(lookup, item.src, item.zh)
        entryCount = Object.keys(lookup).length
        return items
      } catch (error) {
        throw error
      }
    },
    status: (pending, error) => {
      translating = pending
      if (error) log.warn(error)
    },
    activity: realtime.activity,
  })

  /** When patching DB / events, cache-only — do not push the whole script into online fill-in */
  function applyCached(text: unknown): string {
    return translate(text)
  }

  const removeDatabaseLoaded = hookMethod(
    DataManager,
    'isDatabaseLoaded',
    (original) =>
      function () {
        if (!original.call(this)) return false
        if (!DataManager._chayaTransDbPatched) {
          DataManager._chayaTransDbPatched = true
          try {
            enrich.reindexAll(lookup)
            patchDatabaseTexts(applyCached, { log, preserveDialogue: true })
            if (enrich.entryCount) log.ok(`专名词表 ${enrich.entryCount} · 模板 ${enrich.templateCount} · 数字词干 ${enrich.stemCount}`)
          } catch (err) {
            log.warn('数据库套用失败', errMsg(err))
          }
        }
        return true
      }
  )

  const removeOnLoad = hookMethod(
    DataManager,
    'onLoad',
    (original) =>
      function (object: unknown) {
        original.call(this, object)
        if (typeof $dataMap !== 'undefined' && object === $dataMap) {
          try {
            patchMapTexts(applyCached, { quiet: true, log, preserveDialogue: true })
          } catch (err) {
            log.warn('地图套用失败', errMsg(err))
          }
        }
      }
  )
  hot.__chayaTransDispose = () => {
    clearInterval(poll)
    if (reloadTimer) clearTimeout(reloadTimer)
    watcher?.close()
    catchUp.dispose()
    realtime.dispose()
    hot.__chayaDialogueCleanup?.()
    hot.__chayaSubtitleCleanup?.()
    delete hot.__chayaDialogueCleanup
    delete hot.__chayaSubtitleCleanup
    removeEngineHooks()
    removeDatabaseLoaded()
    removeOnLoad()
    delete hot.__chayaTransDispose
  }
}

main()
