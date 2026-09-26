// @ts-nocheck
import { loadBingApi, loadUndiciRequest, path, rt } from './env'
import { MODEL, NET_RETRY_RANGES, OLLAMA, OLLAMA_CHUNK_CHARS, OLLAMA_CHUNK_LINES, OLLAMA_NUM_CTX, SYSTEM, browserHeaders, nextClientProfile } from './constants'
import { createPacedGap, isNetSoftFail, peersDone, settleEngineFails } from './store-queue'
import { isEngineEnabled, parseMarked, splitLines } from './switches'
import { randomBetween, sleep } from './text-cache'
import { isSensitiveForCloud } from '../sensitive-text'

export async function bingTranslate(text, gap) {
  let lastErr
  for (let attempt = 0; attempt <= NET_RETRY_RANGES.length; attempt++) {
    if (attempt > 0) {
      const [min, max] = NET_RETRY_RANGES[attempt - 1]
      const wait = randomBetween(min, max)
      console.warn(`[bing] 限流，第 ${attempt} 次退避 ${(wait / 1000).toFixed(1)}s…`)
      await sleep(wait)
    }
    try {
      const profile = nextClientProfile()
      const res = await loadBingApi()(text, 'ja', 'zh-Hans', false, false, profile.ua)
      if (!res || !res.translation) throw new Error('empty translation')
      return res.translation
    } catch (err) {
      lastErr = err
      if (!isNetSoftFail(err)) throw err
      if (gap) gap.noteBan(err.message || err)
    }
  }
  throw lastErr
}

export function parseGoogleBody(body) {
  if (!Array.isArray(body) || !Array.isArray(body[0])) throw new Error('empty translation')
  let text = ''
  for (const part of body[0]) {
    if (part && part[0]) text += part[0]
  }
  if (!text) throw new Error('empty translation')
  return text
}

export async function googleTranslateOnce(text, profile) {
  const base = 'https://translate.google.com/translate_a/single'
  const query = {
    client: 'gtx',
    sl: 'ja',
    tl: 'zh-CN',
    hl: 'zh-CN',
    dt: ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'],
    ie: 'UTF-8',
    oe: 'UTF-8',
    otf: '1',
    ssel: '0',
    tsel: '0',
    kc: '7',
    q: text,
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else params.append(key, value)
  }
  let url = `${base}?${params.toString()}`
  const headers = browserHeaders(profile)

  let response
  if (url.length > 2048) {
    params.delete('q')
    url = `${base}?${params.toString()}`
    response = await loadUndiciRequest()(url, {
      method: 'POST',
      body: new URLSearchParams({ q: text }).toString(),
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    })
  } else {
    response = await loadUndiciRequest()(url, { method: 'GET', headers })
  }

  if (response.statusCode !== 200) {
    await response.body.dump()
    const err = new Error(`Google Translate responded with the status code ${response.statusCode}.`)
    err.name = 'TranslateResponseError'
    err.statusCode = response.statusCode
    throw err
  }

  let body
  try {
    body = await response.body.json()
  } catch (cause) {
    const err = new Error('Google Translate returned a malformed response.')
    err.cause = cause
    throw err
  }
  return parseGoogleBody(body)
}

export async function googleTranslate(text, gap) {
  let lastErr
  for (let attempt = 0; attempt <= NET_RETRY_RANGES.length; attempt++) {
    if (attempt > 0) {
      const [min, max] = NET_RETRY_RANGES[attempt - 1]
      const wait = randomBetween(min, max)
      console.warn(`[google] 限流，第 ${attempt} 次退避 ${(wait / 1000).toFixed(1)}s…`)
      await sleep(wait)
    }
    try {
      return await googleTranslateOnce(text, nextClientProfile())
    } catch (err) {
      lastErr = err
      if (!isNetSoftFail(err)) throw err
      if (gap) gap.noteBan(err.message || err)
    }
  }
  throw lastErr
}

export async function netChunk(tag, translateFn, items, gap, store) {
  if (items.length === 1) {
    const apiText = store.prepareApiText(items[0])
    const raw = await translateFn(apiText, gap)
    return [store.finishTranslation(items[0], raw)]
  }
  const apiItems = items.map((src) => store.prepareApiText(src))
  const translated = await translateFn(apiItems.join('\n'), gap)
  const lines = splitLines(translated)
  if (lines.length === items.length) {
    return items.map((src, index) => store.finishTranslation(src, lines[index]))
  }
  console.warn(`[${tag}] 行数对不上（${lines.length} ≠ ${items.length}），对半再翻`)
  await gap.wait('对半前')
  const mid = Math.ceil(items.length / 2)
  const left = await netChunk(tag, translateFn, items.slice(0, mid), gap, store)
  await gap.wait('对半间隔')
  const right = await netChunk(tag, translateFn, items.slice(mid), gap, store)
  return left.concat(right)
}

export async function ollamaChat(text) {
  let res
  try {
    res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        think: false,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
        options: { temperature: 0.2, num_ctx: OLLAMA_NUM_CTX, num_predict: -1 },
      }),
      signal: AbortSignal.timeout(60 * 60 * 1000),
    })
  } catch (err) {
    const cause = err && err.cause && (err.cause.code || err.cause.message)
    throw new Error(cause ? `连接中断: ${cause}` : err.message || 'fetch failed')
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let content = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.error) throw new Error(msg.error)
      content += (msg.message && msg.message.content) || ''
    }
  }
  if (!content) throw new Error('模型没有返回译文')
  return content
}

export async function ollamaOnce(items, store) {
  if (!items.length) return []
  if (items.length === 1) {
    const apiText = store.prepareApiText(items[0])
    const raw = splitLines(await ollamaChat(apiText))
      .join('')
      .trim()
    if (!raw) return items.slice()
    store.put(items[0], store.finishTranslation(items[0], raw), 'ollama')
    return store.has(items[0]) ? [] : items.slice()
  }
  const apiItems = items.map((src) => store.prepareApiText(src))
  const marked = apiItems.map((text, index) => `⟦${index}⟧${text}`).join('\n')
  const found = parseMarked(await ollamaChat(marked), items.length)
  const pairs = []
  found.forEach((value, index) => {
    pairs.push([items[index], store.finishTranslation(items[index], value)])
  })
  store.putMany(pairs, 'ollama')
  // 解析失败，或质检未通过（仍含日文未入库）都算缺失，交还队列
  return items.filter((src, index) => !found.has(index) || !store.has(src))
}

export async function runNetWorker(tag, translateFn, chunkChars, queue, store, state, progress, doneKey, failLedger) {
  const gap = createPacedGap(tag)
  // 错开启动，避免和另一路公网同一秒打出
  if (tag === 'google') await sleep(randomBetween(1200, 2800))
  if (tag === 'bing') await sleep(randomBetween(0, 800))

  let paused = false
  while (store.pending() > 0 || queue.remaining() > 0) {
    if (!isEngineEnabled(tag)) {
      if (!paused) {
        paused = true
        state[doneKey] = true
        console.log(`[${tag}] 已暂停（开关关闭，改 ${path.basename(rt().SWITCHES_FILE)} 可恢复）`)
      }
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(1500)
      continue
    }
    if (paused) {
      paused = false
      state[doneKey] = false
      console.log(`[${tag}] 已恢复`)
    }

    if (queue.remaining() === 0) {
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(800)
      continue
    }
    const items = await queue.take(9999, chunkChars, store, tag)
    if (!items.length) {
      // 队列里只剩本引擎已失败的条目：等其他开启引擎收尾后退出
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(500)
      continue
    }
    // 取到队列后若开关刚关，退回再暂停
    if (!isEngineEnabled(tag)) {
      await queue.requeue(items)
      continue
    }

    /* 敏感条不送公网：记本引擎失败交给 Ollama；勿混进同片，避免一条拒收拖死整片 */
    const safe = []
    const nsfw = []
    for (const src of items) {
      const probe = typeof store.prepareApiText === 'function' ? store.prepareApiText(src) : src
      if (isSensitiveForCloud(src) || isSensitiveForCloud(probe)) nsfw.push(src)
      else safe.push(src)
    }
    if (nsfw.length) {
      const { retry, gaveUp } = settleEngineFails(failLedger, store, tag, nsfw)
      console.warn(`[${tag}] 跳过敏感 ${nsfw.length} 条（不送公网）` + (retry.length ? `，${retry.length} 条交其他引擎` : '') + (gaveUp ? `，放弃 ${gaveUp} 条` : ''))
      if (retry.length) await queue.requeue(retry)
    }
    if (!safe.length) continue

    const tagNo = await progress.next()
    const started = Date.now()
    console.log(`[${tag}] 分片 ${tagNo}：${safe.length} 条，${safe.join('\n').length} 字，待译 ${store.pending()}`)
    try {
      const lines = await netChunk(tag, translateFn, safe, gap, store)
      const pairs = safe.map((src, i) => [src, lines[i]])
      const { rejected } = store.putMany(pairs, tag)
      // 缺行/空译文也算本引擎失败
      const missing = safe.filter((src) => !store.has(src))
      const failed = [...new Set([...(rejected || []), ...missing])]
      if (failed.length) {
        const { retry, gaveUp } = settleEngineFails(failLedger, store, tag, failed)
        if (gaveUp) {
          console.warn(`[${tag}] 分片 ${tagNo}：放弃 ${gaveUp} 条（当前开启引擎均已失败）→ ${path.basename(rt().SKIPPED_NDJSON)}`)
        }
        if (retry.length) {
          console.warn(`[${tag}] 分片 ${tagNo}：${retry.length} 条交其他引擎`)
          await queue.requeue(retry)
        }
      }
      gap.noteSuccess()
    } catch (err) {
      // 限流/网络：不记永久失败，仅退回
      console.warn(`[${tag}] 分片 ${tagNo} 失败，退回队列: ${err.message || err}`)
      gap.noteBan(err.message || err)
      await queue.requeue(safe.filter((src) => !store.has(src)))
      await gap.wait('失败后')
      continue
    }
    console.log(`[${tag}] 分片 ${tagNo} 完成，${((Date.now() - started) / 1000).toFixed(1)}s`)
    if (queue.remaining() > 0) await gap.wait('下一片前')
  }
  state[doneKey] = true
  console.log(`[${tag}] 结束`)
}

export async function runOllama(queue, store, state, progress, failLedger) {
  let paused = false

  while (true) {
    if (!isEngineEnabled('ollama')) {
      if (!paused) {
        paused = true
        state.ollamaDone = true
        console.log(`[ollama] 已暂停（开关关闭，改 ${path.basename(rt().SWITCHES_FILE)} 可恢复）`)
      }
      if (store.pending() === 0 || peersDone(state, 'ollamaDone')) break
      await sleep(1500)
      continue
    }
    if (paused) {
      paused = false
      state.ollamaDone = false
      console.log('[ollama] 已恢复')
    }

    if (queue.remaining() === 0) {
      if (store.pending() === 0 || peersDone(state, 'ollamaDone')) break
      await sleep(800)
      continue
    }
    const items = await queue.take(OLLAMA_CHUNK_LINES, OLLAMA_CHUNK_CHARS, store, 'ollama')
    if (!items.length) {
      if (store.pending() === 0 || peersDone(state, 'ollamaDone')) break
      await sleep(500)
      continue
    }
    if (!isEngineEnabled('ollama')) {
      await queue.requeue(items)
      continue
    }
    const tag = await progress.next()
    const started = Date.now()
    console.log(`[ollama] 分片 ${tag}：${items.length} 条，${items.join('\n').length} 字，待译 ${store.pending()}`)
    let missing = []
    let transient = false
    try {
      missing = await ollamaOnce(items, store)
    } catch (err) {
      console.warn(`[ollama] 分片 ${tag} 失败，退回队列: ${err.message || err}`)
      missing = items.filter((src) => !store.has(src))
      transient = true
    }
    if (transient) {
      await queue.requeue(missing)
    } else if (missing.length) {
      const { retry, gaveUp } = settleEngineFails(failLedger, store, 'ollama', missing)
      if (gaveUp) {
        console.warn(`[ollama] 分片 ${tag}：放弃 ${gaveUp} 条（当前开启引擎均已失败）→ ${path.basename(rt().SKIPPED_NDJSON)}`)
      }
      if (retry.length) {
        console.warn(`[ollama] 分片 ${tag}：${retry.length} 条交其他引擎（本引擎不再重试）`)
        await queue.requeue(retry)
      }
    }
    console.log(`[ollama] 分片 ${tag} 新增 ${items.length - missing.length} 条，${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  state.ollamaDone = true
  console.log('[ollama] 结束')
}
