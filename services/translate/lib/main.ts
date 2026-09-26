// @ts-nocheck
import { glossary, path, rt } from './env'
import { BING_CHUNK_CHARS, GOOGLE_CHUNK_CHARS, NET_GAP_MAX_MS, NET_GAP_MIN_MS, OLLAMA_CHUNK_CHARS, OLLAMA_CHUNK_LINES } from './constants'
import { bingTranslate, googleTranslate, runNetWorker, runOllama } from './engines'
import { enrichGlossaryFromSeed, loadGlossaryEntries, maskGlossary, remaskGlossaryFilled, tryComposeGlossaryShell, unmaskGlossary } from './glossary'
import { createProgress, createQueue, createStore, estimateChunks, loadDialoguePriorityOrder, translateGlossaryFirst } from './store-queue'
import { createFailLedger, enabledEngineNames, ensureSwitchesFile, parseCliSwitches, readSwitches } from './switches'
import {
  appendNdjsonPairs,
  classifyTerm,
  isVoiceOnlyLine,
  loadJson,
  loadNdjsonCache,
  loadTokenizer,
  peelNoise,
  purgeBadCacheEntries,
  shouldTranslate,
  swapTrailingNumber,
  trailingNumberParts,
  translateVoiceOnlyLine,
  tryFixedPhrase,
  wrapNoise,
} from './text-cache'

export async function main() {
  parseCliSwitches()
  ensureSwitchesFile()

  const original = loadJson(rt().INPUT, null)
  if (!original) throw new Error(`找不到待译种子表 ${path.basename(rt().INPUT)}`)

  console.log('加载 kuromoji 词典…')
  const tokenizer = await loadTokenizer()
  glossary.entries = loadGlossaryEntries()
  const byType = {}
  for (const entry of glossary.entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1
  }
  console.log(`词表 ${glossary.entries.length} 个：`, byType)
  glossary.zh = await translateGlossaryFirst(glossary.entries)

  const ndjsonCache = loadNdjsonCache(rt().CACHE_NDJSON)

  // 把本作已有缓存导入全局库（已有不覆盖），再加载共享库作为 seed 基底
  const imported = rt().SHARED_CACHE.importIgnoreExisting(ndjsonCache, `game:${path.basename(rt().CONTENT_ROOT)}`)
  if (imported.inserted) {
    console.log(`共享库：从本作导入 ${imported.inserted} 条新译文`)
  }
  const sharedMap = rt().SHARED_CACHE.loadAll()
  const sharedStats = rt().SHARED_CACHE.stats()
  console.log(`共享库：${sharedStats.entries} 条 → ${path.basename(sharedStats.file)}`)

  // seed：共享库 ∪ 本作缓存（本作覆盖共享，便于单作手改）
  const seed = Object.assign({}, sharedMap, ndjsonCache)
  const purgedBad = purgeBadCacheEntries(seed)
  if (purgedBad) {
    console.log(`缓存质检：剔除仍含日文/无效译文 ${purgedBad} 条，将重新翻译`)
  }

  // 已译短词条并进词表（如缓存里的「アルマ」），便于「〇〇先生」本地拼接
  glossary.entries = enrichGlossaryFromSeed(glossary.entries, seed, tokenizer)
  for (const entry of glossary.entries) {
    if (!glossary.zh[entry.jp] && seed[entry.jp]) {
      glossary.zh[entry.jp] = seed[entry.jp]
    }
  }
  const glossarySet = new Set(glossary.entries.map((entry) => entry.jp))

  const allJa = []
  const seen = new Set()
  let skipped = 0
  let glossaryHit = 0

  for (const key of Object.keys(original)) {
    const src = String(original[key] ?? '').replace(/[\r\n]+/g, ' ')
    if (!shouldTranslate(src)) {
      skipped += 1
      continue
    }
    if (seen.has(src)) continue
    seen.add(src)
    allJa.push(src)
  }

  // 共享命中但本作 ndjson 没有：只补本作实际用到的句子，供局内 ChayaTrans
  const syncToGame = []
  for (const src of allJa) {
    if (ndjsonCache[src]) continue
    const zh = sharedMap[src]
    if (!zh) continue
    syncToGame.push([src, zh])
  }
  if (syncToGame.length) {
    appendNdjsonPairs(rt().CACHE_NDJSON, syncToGame)
    console.log(`共享→本作 ndjson：补写 ${syncToGame.length} 条（仅本作用到的）`)
  }

  // 词表里的纯名词：直接用预译文，不再进句子队列
  for (const src of allJa) {
    if (!glossarySet.has(src)) continue
    const zh = glossary.zh[src] || src
    if (!seed[src] || seed[src] === src) {
      seed[src] = zh
      glossaryHit += 1
    }
  }

  // 固定短 UI / 应答
  let fixedHit = 0
  const fixedPairs = []
  for (const src of allJa) {
    if (seed[src]) continue
    const zh = tryFixedPhrase(src)
    if (!zh) continue
    seed[src] = zh
    fixedPairs.push([src, zh])
    fixedHit += 1
  }
  if (fixedPairs.length) {
    appendNdjsonPairs(rt().CACHE_NDJSON, fixedPairs)
    rt().SHARED_CACHE.upsertMany(fixedPairs, 'fixed-phrase')
    console.log(`固定短语直出 ${fixedHit} 条（不耗 API）`)
  }

  // 占位后只剩称呼/标点/口吃：本地拼接，不送 API
  let shellHit = 0
  const shellPairs = []
  for (const src of allJa) {
    if (seed[src]) continue
    const zh = tryComposeGlossaryShell(src, glossary.entries, glossary.zh)
    if (!zh) continue
    seed[src] = zh
    shellPairs.push([src, zh])
    shellHit += 1
  }
  if (shellPairs.length) {
    appendNdjsonPairs(rt().CACHE_NDJSON, shellPairs)
    rt().SHARED_CACHE.upsertMany(shellPairs, 'glossary-shell')
    console.log(`词表壳句本地拼接 ${shellHit} 条（不耗 API）`)
  }

  // 语气/娇喘声：规则音素映射，不走公网/Ollama
  let voiceHit = 0
  const voicePairs = []
  for (const src of allJa) {
    if (seed[src]) continue
    const { core, prefix, suffix } = peelNoise(src)
    if (!isVoiceOnlyLine(core)) continue
    const zh = wrapNoise(translateVoiceOnlyLine(core), prefix, suffix)
    seed[src] = zh
    voicePairs.push([src, zh])
    voiceHit += 1
  }
  if (voicePairs.length) {
    appendNdjsonPairs(rt().CACHE_NDJSON, voicePairs)
    rt().SHARED_CACHE.upsertMany(voicePairs, 'voice-rule')
    console.log(`语气声规则直出 ${voiceHit} 条（不耗 API）`)
  }

  const stemGroups = new Map()
  const termFamilies = new Map()
  const sentences = []
  let termCount = 0

  for (const src of allJa) {
    if (seed[src] && glossarySet.has(src)) continue
    const info = classifyTerm(tokenizer, src)
    if (info.kind !== 'term') {
      sentences.push(src)
      continue
    }
    termCount += 1
    if (!stemGroups.has(info.stem)) stemGroups.set(info.stem, [])
    stemGroups.get(info.stem).push({ src, num: info.num })
  }

  let hit = 0
  let derived = 0
  let todo = []

  // 句子里再抽「同前缀+尾数字」族（含助词の的短名也适用）
  const numberStemGroups = new Map()
  const plainSentences = []
  for (const src of sentences) {
    const parts = trailingNumberParts(src)
    if (!parts) {
      if (seed[src]) hit += 1
      else plainSentences.push(src)
      continue
    }
    if (!numberStemGroups.has(parts.stem)) numberStemGroups.set(parts.stem, [])
    numberStemGroups.get(parts.stem).push({ src, num: parts.num })
  }

  // 若词干本身也在表里，并入同族（含已缓存）
  for (const [stem, members] of numberStemGroups) {
    if (seen.has(stem) && !members.some((m) => m.src === stem)) {
      members.push({ src: stem, num: '' })
    }
  }

  for (const src of plainSentences) {
    todo.push(src)
  }

  const absorbFamily = (members) => {
    members.sort((a, b) => a.num.length - b.num.length || a.src.localeCompare(b.src))
    const stem = members[0].stem || trailingNumberParts(members[0].src)?.stem || members[0].src.replace(/[0-9０-９]+$/, '')
    for (const item of members) {
      termFamilies.set(item.src, { stem, num: item.num, members })
    }
    const cached = members.find((item) => seed[item.src])
    if (cached) {
      for (const item of members) {
        if (seed[item.src]) {
          hit += 1
          continue
        }
        seed[item.src] = swapTrailingNumber(seed[cached.src], cached.num, item.num)
        derived += 1
      }
      return
    }
    // 只送一条进队列，其余等展开；单条也照常入队
    todo.push(members[0].src)
  }

  for (const [, members] of stemGroups) {
    members.sort((a, b) => a.num.length - b.num.length || a.src.localeCompare(b.src))
    const stem = classifyTerm(tokenizer, members[0].src).stem
    for (const item of members) {
      termFamilies.set(item.src, { stem, num: item.num, members })
    }

    const cached = members.find((item) => seed[item.src])
    if (cached) {
      for (const item of members) {
        if (seed[item.src]) {
          hit += 1
          continue
        }
        seed[item.src] = swapTrailingNumber(seed[cached.src], cached.num, item.num)
        derived += 1
      }
      continue
    }

    todo.push(members[0].src)
  }

  for (const [, members] of numberStemGroups) {
    absorbFamily(
      members.map((m) => ({
        ...m,
        stem: trailingNumberParts(m.src)?.stem || m.src.replace(/[0-9０-９]+$/, ''),
      }))
    )
  }

  // 词表占位后，句式相同的只翻一条
  const templateFamilies = new Map()
  const templateGroups = new Map()
  for (const src of todo) {
    const { masked, slots } = maskGlossary(src, glossary.entries)
    if (!templateGroups.has(masked)) templateGroups.set(masked, [])
    templateGroups.get(masked).push({ src, slots, masked })
  }

  let templateSaved = 0
  const collapsed = []
  for (const [, members] of templateGroups) {
    for (const item of members) {
      templateFamilies.set(item.src, { masked: item.masked, slots: item.slots, members })
    }
    const cached = members.find((item) => seed[item.src])
    if (cached) {
      for (const item of members) {
        if (seed[item.src]) continue
        const maskedZh = remaskGlossaryFilled(seed[cached.src], cached.slots, glossary.zh)
        seed[item.src] = unmaskGlossary(maskedZh, item.slots, glossary.zh)
        derived += 1
        templateSaved += 1
      }
      continue
    }
    collapsed.push(members[0].src)
    templateSaved += Math.max(0, members.length - 1)
  }
  todo = collapsed

  const pending = new Set()
  for (const src of allJa) {
    if (!seed[src]) pending.add(src)
  }

  const failLedger = createFailLedger()
  let skippedGaveUp = 0
  for (const src of [...pending]) {
    if (!failLedger.hasGivenUp(src)) continue
    pending.delete(src)
    skippedGaveUp += 1
  }
  if (skippedGaveUp) {
    console.log(`跳过此前已放弃 ${skippedGaveUp} 条（当前开启引擎均已失败，见 ${path.basename(rt().SKIPPED_NDJSON)}）`)
  }

  const store = createStore(original, [seed], pending, termFamilies, templateFamilies)
  let queuedOnly = todo.filter((src) => !store.has(src) && !failLedger.hasGivenUp(src))

  // 按 extract.strings 的对话游玩顺序优先：不必知道「玩家下一句」，事件列表本身有序。
  const dialogueOrder = loadDialoguePriorityOrder()
  if (dialogueOrder.size) {
    const rank = (src) => (dialogueOrder.has(src) ? dialogueOrder.get(src) : 1e12)
    const before = queuedOnly.length
    queuedOnly = queuedOnly.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const dialogueQueued = queuedOnly.filter((src) => dialogueOrder.has(src)).length
    console.log(`队列已按对话顺序优先：对话相关 ${dialogueQueued}/${before}，其余靠后`)
  }

  console.log(
    `合并翻译：跳过 ${skipped}，缓存命中 ${hit}，词表直出 ${glossaryHit}，预套用 ${derived}（模板可省 ${templateSaved}），` +
      `词条 ${termCount} / 句子 ${sentences.length}，队列 ${queuedOnly.length}，待完成 ${pending.size}` +
      (skippedGaveUp ? `，已放弃 ${skippedGaveUp}` : '')
  )
  console.log(`结果文件：${path.basename(rt().CACHE_NDJSON)}（追加写入；不再生成 merged.json）`)
  await store.flushCache()

  if (!queuedOnly.length && pending.size === 0) {
    console.log('没有需要翻译的日文。')
    return
  }

  const queue = createQueue(queuedOnly, failLedger)
  const bingChunks = estimateChunks(queuedOnly, 9999, BING_CHUNK_CHARS)
  const googleChunks = estimateChunks(queuedOnly, 9999, GOOGLE_CHUNK_CHARS)
  const ollamaChunks = estimateChunks(queuedOnly, OLLAMA_CHUNK_LINES, OLLAMA_CHUNK_CHARS)
  const estimatedTotal = Math.max(1, Math.ceil((bingChunks + googleChunks + ollamaChunks) / 3))
  const progress = createProgress(estimatedTotal)
  const workerState = { bingDone: false, googleDone: false, ollamaDone: false }
  console.log(
    `预估总分片约 ${estimatedTotal}（bing ${bingChunks} / google ${googleChunks} / ollama ${ollamaChunks}）；` + `公网间隔 ${NET_GAP_MIN_MS / 1000}-${NET_GAP_MAX_MS / 1000}s`
  )
  {
    const sw = readSwitches(true)
    const on = enabledEngineNames().join('+') || '无'
    console.log(
      `引擎开关：bing=${sw.bing ? '开' : '关'} google=${sw.google ? '开' : '关'} ollama=${sw.ollama ? '开' : '关'}` +
        `（生效：${on}；改 ${path.basename(rt().SWITCHES_FILE)} 可随时切换）`
    )
  }

  const stop = async (signal) => {
    console.warn(`收到 ${signal}，先落盘 NDJSON 缓存…`)
    try {
      await store.flushCache()
    } catch (err) {
      console.warn('落盘失败:', err.message || err)
    }
    process.exit(0)
  }
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))

  await Promise.all([
    runNetWorker('bing', bingTranslate, BING_CHUNK_CHARS, queue, store, workerState, progress, 'bingDone', failLedger),
    runNetWorker('google', googleTranslate, GOOGLE_CHUNK_CHARS, queue, store, workerState, progress, 'googleDone', failLedger),
    runOllama(queue, store, workerState, progress, failLedger),
  ])
  await store.flushCache()
  console.log(`翻译循环结束，仍待译 ${store.pending()}；结果在 ${path.basename(rt().CACHE_NDJSON)}` + `；放弃记录 ${path.basename(rt().SKIPPED_NDJSON)}`)
  if (process.argv.includes('--write-merged')) {
    await store.writeMerged()
  }
  process.exit(0)
}
