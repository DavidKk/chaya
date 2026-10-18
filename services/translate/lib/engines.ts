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
      console.warn(`[bing] Rate limited, backing off attempt ${attempt} for ${(wait / 1000).toFixed(1)}s...`)
      await sleep(wait)
    }
    try {
      const profile = nextClientProfile()
      const res = await loadBingApi()(text, 'auto-detect', 'zh-Hans', false, false, profile.ua)
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
    sl: 'auto',
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
      console.warn(`[google] Rate limited, backing off attempt ${attempt} for ${(wait / 1000).toFixed(1)}s...`)
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
  console.warn(`[${tag}] Line count mismatch (${lines.length} != ${items.length}), retrying in halves`)
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
    throw new Error(cause ? `Connection aborted: ${cause}` : err.message || 'fetch failed')
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
  if (!content) throw new Error('Model did not return a translation')
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
  // Treat parse failures and rejected output with remaining Japanese as missing entries and return them to the queue.
  return items.filter((src, index) => !found.has(index) || !store.has(src))
}

export async function runNetWorker(tag, translateFn, chunkChars, queue, store, state, progress, doneKey, failLedger) {
  const gap = createPacedGap(tag)
  // Stagger startup to avoid simultaneous public-engine requests.
  if (tag === 'google') await sleep(randomBetween(1200, 2800))
  if (tag === 'bing') await sleep(randomBetween(0, 800))

  let paused = false
  while (store.pending() > 0 || queue.remaining() > 0) {
    if (!isEngineEnabled(tag)) {
      if (!paused) {
        paused = true
        state[doneKey] = true
        console.log(`[${tag}] Paused (switch disabled; edit ${path.basename(rt().SWITCHES_FILE)} to resume)`)
      }
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(1500)
      continue
    }
    if (paused) {
      paused = false
      state[doneKey] = false
      console.log(`[${tag}] Resumed`)
    }

    if (queue.remaining() === 0) {
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(800)
      continue
    }
    const items = await queue.take(9999, chunkChars, store, tag)
    if (!items.length) {
      // If the queue contains only this engine's failed entries, wait for other enabled engines to finish and exit.
      if (store.pending() === 0 || peersDone(state, doneKey)) break
      await sleep(500)
      continue
    }
    // If the engine was disabled after taking a batch, return the batch before pausing.
    if (!isEngineEnabled(tag)) {
      await queue.requeue(items)
      continue
    }

    /* Do not send sensitive rows to public engines. Mark this engine's failure and leave them for Ollama; never mix them into a public batch. */
    const safe = []
    const nsfw = []
    for (const src of items) {
      const probe = typeof store.prepareApiText === 'function' ? store.prepareApiText(src) : src
      if (isSensitiveForCloud(src) || isSensitiveForCloud(probe)) nsfw.push(src)
      else safe.push(src)
    }
    if (nsfw.length) {
      const { retry, gaveUp } = settleEngineFails(failLedger, store, tag, nsfw)
      console.warn(
        `[${tag}] Skipped ${nsfw.length} sensitive items` + (retry.length ? `, passing ${retry.length} to other engines` : '') + (gaveUp ? `, gave up on ${gaveUp} items` : '')
      )
      if (retry.length) await queue.requeue(retry)
    }
    if (!safe.length) continue

    const tagNo = await progress.next()
    const started = Date.now()
    console.log(`[${tag}] Chunk ${tagNo}: ${safe.length} items, ${safe.join('\n').length} chars, pending: ${store.pending()}`)
    try {
      const lines = await netChunk(tag, translateFn, safe, gap, store)
      const pairs = safe.map((src, i) => [src, lines[i]])
      const { rejected } = store.putMany(pairs, tag)
      // Missing rows and empty translations count as failures for this engine.
      const missing = safe.filter((src) => !store.has(src))
      const failed = [...new Set([...(rejected || []), ...missing])]
      if (failed.length) {
        const { retry, gaveUp } = settleEngineFails(failLedger, store, tag, failed)
        if (gaveUp) {
          console.warn(`[${tag}] Chunk ${tagNo}: gave up on ${gaveUp} items (all enabled engines failed) -> ${path.basename(rt().SKIPPED_NDJSON)}`)
        }
        if (retry.length) {
          console.warn(`[${tag}] Chunk ${tagNo}: passing ${retry.length} items to other engines`)
          await queue.requeue(retry)
        }
      }
      gap.noteSuccess()
    } catch (err) {
      // Return rate-limited or network-failed items without marking permanent failure.
      console.warn(`[${tag}] Chunk ${tagNo} failed, returned to queue: ${err.message || err}`)
      gap.noteBan(err.message || err)
      await queue.requeue(safe.filter((src) => !store.has(src)))
      await gap.wait('失败后')
      continue
    }
    console.log(`[${tag}] Chunk ${tagNo} completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    if (queue.remaining() > 0) await gap.wait('下一片前')
  }
  state[doneKey] = true
  console.log(`[${tag}] Finished`)
}

export async function runOllama(queue, store, state, progress, failLedger) {
  let paused = false

  while (true) {
    if (!isEngineEnabled('ollama')) {
      if (!paused) {
        paused = true
        state.ollamaDone = true
        console.log(`[ollama] Paused (switch disabled; edit ${path.basename(rt().SWITCHES_FILE)} to resume)`)
      }
      if (store.pending() === 0 || peersDone(state, 'ollamaDone')) break
      await sleep(1500)
      continue
    }
    if (paused) {
      paused = false
      state.ollamaDone = false
      console.log('[ollama] Resumed')
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
    console.log(`[ollama] Chunk ${tag}: ${items.length} items, ${items.join('\n').length} chars, pending: ${store.pending()}`)
    let missing = []
    let transient = false
    try {
      missing = await ollamaOnce(items, store)
    } catch (err) {
      console.warn(`[ollama] Chunk ${tag} failed, returned to queue: ${err.message || err}`)
      missing = items.filter((src) => !store.has(src))
      transient = true
    }
    if (transient) {
      await queue.requeue(missing)
    } else if (missing.length) {
      const { retry, gaveUp } = settleEngineFails(failLedger, store, 'ollama', missing)
      if (gaveUp) {
        console.warn(`[ollama] Chunk ${tag}: gave up on ${gaveUp} items (all enabled engines failed) -> ${path.basename(rt().SKIPPED_NDJSON)}`)
      }
      if (retry.length) {
        console.warn(`[ollama] Chunk ${tag}: passing ${retry.length} items to other engines (no further retries here)`)
        await queue.requeue(retry)
      }
    }
    console.log(`[ollama] Chunk ${tag}: added ${items.length - missing.length} items in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  state.ollamaDone = true
  console.log('[ollama] Finished')
}
