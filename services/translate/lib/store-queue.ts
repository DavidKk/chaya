// @ts-nocheck
import { isStorableTranslation } from '../text-classify'
import { glossary, rt } from './env'
import { CACHE_APPEND_MS, MODEL, NET_BAN_GAP_STEPS, NET_GAP_MAX_MS, NET_GAP_MIN_MS, OLLAMA } from './constants'
import { maskGlossary, remaskGlossaryFilled, unmaskGlossary } from './glossary'
import { isEngineEnabled } from './switches'
import { appendNdjsonPairs, isAcceptableTranslation, loadJson, randomBetween, saveJson, sleep, writeMergedOutput } from './text-cache'

export function createStore(original, seedCaches, pendingSet, termFamilies, templateFamilies) {
  const cache = {}
  for (const seed of seedCaches) {
    Object.assign(cache, seed)
  }

  let writing = Promise.resolve()
  const pendingAppend = []
  let lastAppend = 0

  const markDone = (src) => {
    pendingSet.delete(src)
  }

  const flushAppend = (force = false) => {
    const now = Date.now()
    if (!pendingAppend.length) return writing
    if (!force && now - lastAppend < CACHE_APPEND_MS) return writing
    const batch = pendingAppend.splice(0, pendingAppend.length)
    lastAppend = now
    writing = writing.then(() => {
      appendNdjsonPairs(rt().CACHE_NDJSON, batch)
      try {
        rt().SHARED_CACHE.upsertMany(batch, 'pipeline')
      } catch (err) {
        console.warn(`[shared-cache] 写入失败: ${err.message || err}`)
      }
    })
    return writing
  }

  const remember = (src, value) => {
    if (!isAcceptableTranslation(src, value)) return false
    if (cache[src]) {
      markDone(src)
      return false
    }
    cache[src] = value
    markDone(src)
    pendingAppend.push([src, value])
    return true
  }

  const expandTermFamily = (src, value) => {
    const meta = termFamilies.get(src)
    if (!meta || !value) return 0
    let extra = 0
    for (const sibling of meta.members) {
      if (sibling.src === src || cache[sibling.src]) {
        markDone(sibling.src)
        continue
      }
      const derived = swapTrailingNumber(value, meta.num, sibling.num)
      if (remember(sibling.src, derived)) extra += 1
    }
    return extra
  }

  const expandTemplateFamily = (src, value) => {
    const meta = templateFamilies.get(src)
    if (!meta || !value) return 0
    let extra = 0
    const maskedZh = remaskGlossaryFilled(value, meta.slots, glossary.zh)
    for (const sibling of meta.members) {
      if (sibling.src === src || cache[sibling.src]) {
        markDone(sibling.src)
        continue
      }
      const derived = unmaskGlossary(maskedZh, sibling.slots, glossary.zh)
      if (remember(sibling.src, derived)) extra += 1
    }
    return extra
  }

  const expandAll = (src, value) => expandTermFamily(src, value) + expandTemplateFamily(src, value)

  return {
    has(src) {
      return Boolean(cache[src])
    },
    pending() {
      return pendingSet.size
    },
    abandon(src) {
      pendingSet.delete(src)
    },
    prepareApiText(src) {
      const meta = templateFamilies.get(src)
      if (meta) return meta.masked
      return maskGlossary(src, glossary.entries).masked
    },
    finishTranslation(src, translated) {
      const meta = templateFamilies.get(src)
      const slots = meta ? meta.slots : maskGlossary(src, glossary.entries).slots
      return unmaskGlossary(translated, slots, glossary.zh)
    },
    put(src, value, source) {
      if (!value || cache[src]) {
        if (cache[src]) {
          markDone(src)
          expandAll(src, cache[src])
        }
        return false
      }
      if (!isAcceptableTranslation(src, value)) {
        console.warn(`  [${source}] 仍含日文，不入库: ${src.length > 36 ? `${src.slice(0, 36)}…` : src}`)
        return false
      }
      remember(src, value)
      const extra = expandAll(src, value)
      console.log(`  [${source}] ${src.length > 36 ? `${src.slice(0, 36)}…` : src} -> ${String(value).slice(0, 36)}` + (extra ? `（套用 +${extra}）` : ''))
      flushAppend()
      return true
    },
    putMany(pairs, source) {
      let added = 0
      let extra = 0
      const rejected = []
      for (const [src, value] of pairs) {
        if (!value) {
          if (src) rejected.push(src)
          continue
        }
        if (cache[src]) {
          markDone(src)
          extra += expandAll(src, cache[src])
          continue
        }
        if (!isAcceptableTranslation(src, value)) {
          rejected.push(src)
          continue
        }
        remember(src, value)
        added += 1
        extra += expandAll(src, value)
      }
      if (rejected.length) {
        console.warn(`  [${source}] 本批丢弃仍含日文 ${rejected.length} 条`)
      }
      if (added || extra) {
        console.log(`  [${source}] 本批写入 ${added} 条` + (extra ? `，套用 ${extra}` : '') + `，待译剩余 ${pendingSet.size}`)
        flushAppend()
      }
      return { added, extra, rejected }
    },
    size() {
      return Object.keys(cache).length
    },
    /** 只落 NDJSON 追加缓冲，不写 merged。 */
    async flushCache() {
      lastAppend = 0
      await flushAppend(true)
    },
    /** 可选：导出 chaya-trans.merged.json（默认不需要） */
    async writeMerged() {
      await this.flushCache()
      writeMergedOutput(original, cache)
    },
    async flush() {
      await this.flushCache()
    },
  }
}

export async function translateGlossaryFirst(entries) {
  const cached = loadJson(rt().GLOSSARY_CACHE, {})
  const glossaryZh = Object.fromEntries(Object.entries(cached).filter(([src, zh]) => isStorableTranslation(src, zh)))
  const pending = entries
    .map((entry) => entry.jp)
    .filter((jp, index, arr) => arr.indexOf(jp) === index)
    .filter((jp) => !glossaryZh[jp] || glossaryZh[jp] === jp)

  if (!pending.length) {
    console.log(`词表已缓存 ${entries.length} 个，跳过预翻译`)
    for (const entry of entries) {
      if (!glossaryZh[entry.jp]) glossaryZh[entry.jp] = entry.jp
    }
    return glossaryZh
  }

  console.log(`先翻译词表 ${pending.length} 个（人名/物品/技能/装备/状态/敌名）…`)
  const system = ['把日文游戏名词译成简体中文。', '每一行都以 ⟦数字⟧ 开头，必须原样保留编号。', '人名/敌名偏音译；物品/技能/状态用常见游戏用语。', '只输出译文，不要解释。'].join(
    '\n'
  )

  const chunkSize = 40
  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize)
    const body = chunk.map((jp, index) => `⟦${index}⟧${jp}`).join('\n')
    try {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          think: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: body },
          ],
          options: { temperature: 0.1, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      })
      if (!res.ok) throw new Error(`Ollama ${res.status}`)
      const data = await res.json()
      const found = parseMarked((data.message && data.message.content) || '', chunk.length)
      chunk.forEach((jp, index) => {
        const zh = found.get(index)
        if (isStorableTranslation(jp, zh)) glossaryZh[jp] = zh.trim()
      })
      console.log(`  词表进度 ${Math.min(i + chunk.length, pending.length)}/${pending.length}`)
    } catch (err) {
      console.warn(`  词表批次失败，保留原文: ${err.message || err}`)
      chunk.forEach((jp) => {
        if (!glossaryZh[jp]) glossaryZh[jp] = jp
      })
    }
    saveJson(rt().GLOSSARY_CACHE, Object.fromEntries(Object.entries(glossaryZh).filter(([src, zh]) => isStorableTranslation(src, zh))))
  }

  for (const entry of entries) {
    if (!glossaryZh[entry.jp]) glossaryZh[entry.jp] = entry.jp
  }
  saveJson(rt().GLOSSARY_CACHE, Object.fromEntries(Object.entries(glossaryZh).filter(([src, zh]) => isStorableTranslation(src, zh))))
  return glossaryZh
}

export function estimateChunks(items, maxLines, maxChars) {
  let count = 0
  let index = 0
  while (index < items.length) {
    let size = 0
    let taken = 0
    while (index < items.length && taken < maxLines) {
      const text = items[index]
      const extra = taken ? 1 : 0
      if (taken && size + extra + text.length > maxChars) break
      size += extra + text.length
      taken += 1
      index += 1
    }
    if (!taken) {
      index += 1
      continue
    }
    count += 1
  }
  return Math.max(1, count)
}

export function createProgress(totalChunks) {
  let done = 0
  let total = Math.max(1, totalChunks)
  let locked = Promise.resolve()

  function withLock(fn) {
    const run = locked.then(fn, fn)
    locked = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  return {
    next() {
      return withLock(() => {
        done += 1
        if (done > total) total = done
        return `${done}/${total}`
      })
    },
    total() {
      return total
    },
  }
}

/** 从 chaya-extract.strings.json 得到「原文 → 游玩顺序」；同一句取最早出现。 */
export function loadDialoguePriorityOrder() {
  const extracted = loadJson(rt().EXTRACTED, null)
  const blocks = extracted && (extracted.dialogue || extracted.dialogueOrdered)
  if (!Array.isArray(blocks) || !blocks.length) return new Map()

  const order = new Map()
  let seq = 0
  for (const block of blocks) {
    const texts = [...(block.lines || []), ...(block.choices || [])]
    for (const text of texts) {
      const src = String(text || '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
      if (!src || order.has(src)) continue
      order.set(src, seq++)
    }
  }
  return order
}

export function createQueue(items, failLedger) {
  const queue = items.slice()
  let cursor = 0
  let locked = Promise.resolve()

  function withLock(fn) {
    const run = locked.then(fn, fn)
    locked = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  return {
    remaining() {
      return Math.max(0, queue.length - cursor)
    },
    take(maxLines, maxChars, store, engine) {
      return withLock(() => {
        const chunk = []
        let size = 0
        while (cursor < queue.length && chunk.length < maxLines) {
          const text = queue[cursor]
          cursor += 1
          if (store.has(text)) continue
          if (failLedger.hasGivenUp(text)) continue
          // 本引擎已失败过的条目跳过，留给其他仍开启且未失败的引擎
          if (engine && failLedger.hasFail(text, engine)) continue
          const extra = chunk.length ? 1 : 0
          if (chunk.length && size + extra + text.length > maxChars) {
            cursor -= 1
            break
          }
          chunk.push(text)
          size += extra + text.length
        }
        return chunk
      })
    },
    requeue(itemsToFront) {
      return withLock(() => {
        if (!itemsToFront.length) return
        queue.splice(cursor, 0, ...itemsToFront)
      })
    },
  }
}

/** 某引擎对若干条质检/产出失败：记账；若当前开启引擎均已失败则放弃 */
export function settleEngineFails(failLedger, store, engine, srcs) {
  const retry = []
  let gaveUp = 0
  for (const src of srcs) {
    if (!src || store.has(src)) continue
    if (failLedger.noteFail(src, engine)) {
      store.abandon(src)
      gaveUp += 1
    } else {
      retry.push(src)
    }
  }
  return { retry, gaveUp }
}

export function isNetSoftFail(err) {
  const msg = String((err && (err.message || err.statusCode || err.code || err.name)) || err)
  return /429|302|too many|captcha|rate.?limit|maximum text length|unexpected end of json|unexpected token|empty translation|econnreset|etimedout|socket hang up|fetch failed|TranslateResponseError|HTTPError/i.test(
    msg
  )
}

export function createPacedGap(tag) {
  let banLevel = 0
  let successStreak = 0

  return {
    currentRange() {
      if (banLevel <= 0) return [NET_GAP_MIN_MS, NET_GAP_MAX_MS]
      return NET_BAN_GAP_STEPS[Math.min(banLevel, NET_BAN_GAP_STEPS.length) - 1]
    },
    async wait(label = '下一片前') {
      const [min, max] = this.currentRange()
      const wait = randomBetween(min, max)
      console.log(`[${tag}] ${label}随机等待 ${(wait / 1000).toFixed(1)}s（间隔 ${min / 1000}-${max / 1000}s）…`)
      await sleep(wait)
    },
    noteBan(reason) {
      banLevel = Math.min(banLevel + 1, NET_BAN_GAP_STEPS.length)
      successStreak = 0
      const [min, max] = this.currentRange()
      console.warn(`[${tag}] 判定受限（${reason}），之后间隔改为 ${min / 1000}-${max / 1000}s`)
    },
    noteSuccess() {
      if (banLevel <= 0) return
      successStreak += 1
      if (successStreak >= 3) {
        banLevel -= 1
        successStreak = 0
        const [min, max] = this.currentRange()
        console.log(`[${tag}] 连续成功，间隔降回 ${min / 1000}-${max / 1000}s`)
      }
    },
  }
}

export function peersDone(state, selfKey) {
  // 只等「当前开启」的其他引擎；关闭的引擎不挡退出
  const pairs = [
    ['bingDone', 'bing'],
    ['googleDone', 'google'],
    ['ollamaDone', 'ollama'],
  ]
  return pairs.filter(([key, name]) => key !== selfKey && isEngineEnabled(name)).every(([key]) => state[key])
}
