// @ts-nocheck
import { fs, loadKuromoji, path, rt } from './env'
import { JAPANESE, KANA_LETTER } from './constants'
import { isReusableTranslation, isStorableTranslation, shouldTranslate as shouldTranslateSource } from '../text-classify'
import { appendPublicGameCache, writePublicGameDocument } from '@/services/storage/game-files'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function saveJson(file, data, pretty = false) {
  if (file === rt().INPUT) return writePublicGameDocument(rt().CONTENT_ROOT, 'seed', data)
  const body = pretty ? JSON.stringify(data, null, 4) + '\n' : JSON.stringify(data)
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

/** Append source/target pairs as NDJSON rather than rewriting the entire file. */
export function loadNdjsonCache(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const row = JSON.parse(line)
      if (Array.isArray(row) && row.length >= 2 && row[0] && row[1] != null) {
        if (isReusableTranslation(String(row[0]), String(row[1]))) out[String(row[0])] = String(row[1])
      } else if (row && typeof row === 'object' && row.s && row.t != null) {
        if (isReusableTranslation(String(row.s), String(row.t))) out[String(row.s)] = String(row.t)
      }
    } catch {
      // 跳过坏行
    }
  }
  return out
}

export function appendNdjsonPairs(file, pairs) {
  const valid = pairs.filter(([src, zh]) => isStorableTranslation(src, zh))
  if (!valid.length) return
  if (file === rt().CACHE_NDJSON) return appendPublicGameCache(rt().CONTENT_ROOT, valid)
  const chunk = valid.map(([src, zh]) => JSON.stringify([src, zh])).join('\n') + '\n'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, chunk)
}

export function hasJapanese(text) {
  return JAPANESE.test(text)
}

export function isOnlyPunctuation(text) {
  const core = String(text).replace(/[\s\u3000]+/g, '')
  return core.length > 0 && /^[\p{P}\p{S}]+$/u.test(core)
}

export function shouldTranslate(text) {
  return shouldTranslateSource(String(text || ''))
}

/** Seed entries may contain stray leading quotes or trailing script fragments. Remove these before rule-based translation and restore them on writeback to preserve sentence shells. */
export function peelNoise(text) {
  let s = String(text || '')
  let prefix = ''
  let suffix = ''
  const lead = s.match(/^"+/)
  if (lead) {
    prefix = lead[0]
    s = s.slice(prefix.length)
  }
  if (s.endsWith("');")) {
    suffix = "');"
    s = s.slice(0, -3)
  } else if (s.endsWith("')")) {
    suffix = "')"
    s = s.slice(0, -2)
  }
  return { core: s, prefix, suffix }
}

export function wrapNoise(text, prefix, suffix) {
  return `${prefix || ''}${text}${suffix || ''}`
}

/** Allow short kana proper names to retain their source form in the cache, avoiding endless retranslation. */
export function isLikelyKeptName(text) {
  const { core } = peelNoise(text)
  const stripped = core.replace(/[「」『』""''“”‘’（）()【】\[\]\s\u3000#＃…・＝♡♥☆★♪～〜]/g, '')
  if (!stripped || stripped.length > 14) return false
  if (/[\u3040-\u309F]/.test(stripped)) return false
  return /^[\u30A0-\u30FFー]+$/.test(stripped)
}

/** Cache validation rejects empty values, leaked numbering, partial dumps, unchanged sources and remaining kana; fully translated text without kana is accepted. */
export function isAcceptableTranslation(src, zh) {
  const t = String(zh ?? '')
  if (!t.trim()) return false
  if (!isStorableTranslation(src, t)) return false
  if (/⟦[^⟧]*⟧/.test(t)) return false
  if (t.includes(' → ') && KANA_LETTER.test(t)) return false
  if (!KANA_LETTER.test(t)) return true
  if (/[\u3040-\u309F]/.test(t)) return false
  const core = t.replace(/[\s\u3000\p{P}\p{S}0-9０-９a-zA-Z・＝]/gu, '')
  if (!core) return false
  const kana = (core.match(/[\u30A1-\u30FA\u30FC-\u30FF]/g) || []).length
  const han = (core.match(/[\u4E00-\u9FFF]/g) || []).length
  return han >= 2 && kana / core.length <= 0.35
}

/** Remove invalid seed-cache entries and return the number removed. */
export function purgeBadCacheEntries(seed) {
  let purged = 0
  for (const src of Object.keys(seed)) {
    if (!shouldTranslate(src)) continue
    if (isAcceptableTranslation(src, seed[src])) continue
    delete seed[src]
    purged += 1
  }
  return purged
}

export function loadTokenizer() {
  return new Promise((resolve, reject) => {
    loadKuromoji()
      .builder({ dicPath: rt().KUROMOJI_DIC })
      .build((err, tokenizer) => {
        if (err) reject(err)
        else resolve(tokenizer)
      })
  })
}

// Treat text as a glossary entry only when it contains content-word compounds and an optional trailing number.
// Particles, verbs or auxiliary verbs identify a sentence and prevent applying a label template.
export function classifyTerm(tokenizer, text) {
  const tokens = tokenizer.tokenize(text)
  const parts = tokens.filter((token) => token.pos !== '記号' && String(token.surface_form).trim())
  if (!parts.length) return { kind: 'sentence' }

  let num = ''
  const content = parts.slice()
  while (content.length && content[content.length - 1].pos === '名詞' && content[content.length - 1].pos_detail_1 === '数') {
    num = content.pop().surface_form + num
  }
  if (!content.length) return { kind: 'sentence' }

  const hasClause = content.some((token) => token.pos === '助詞' || token.pos === '動詞' || token.pos === '助動詞' || token.pos === '接続詞')
  if (hasClause) return { kind: 'sentence' }

  const lexical = content.every(
    (token) => token.pos === '名詞' || token.pos === '感動詞' || token.pos === '形容詞' || token.pos === '副詞' || token.pos === '接頭詞' || token.pos === '接尾辞'
  )
  if (!lexical) return { kind: 'sentence' }

  const stem = content.map((token) => token.surface_form).join('')
  if (!stem || !hasJapanese(stem)) return { kind: 'sentence' }
  return { kind: 'term', stem, num }
}

export function swapTrailingNumber(translated, fromNum, toNum) {
  if (!toNum) return translated
  if (!fromNum) return /[0-9０-９]+$/.test(translated) ? translated : translated + toNum
  if (/[0-9０-９]+$/.test(translated)) return translated.replace(/[0-9０-９]+$/, toNum)
  return translated + toNum
}

/** Infer trailing-number families with a regex even when kuromoji classifies a short possessive name as a sentence, avoiding duplicate requests within a large batch. */
export function trailingNumberParts(text) {
  const m = String(text || '').match(/^(.*[^\d０-９])([0-9０-９]+)$/)
  if (!m) return null
  const stem = m[1]
  const num = m[2]
  if (!hasJapanese(stem) || stem.length < 2) return null
  // Exclude obvious complete-sentence endings.
  if (/[ただですますねよ]$/u.test(stem)) return null
  if (/[。！？!?]$/.test(stem)) return null
  return { stem, num }
}

export function applyCache(original, cache) {
  const data = { ...original }
  for (const key of Object.keys(original)) {
    const src = String(original[key] ?? '').replace(/[\r\n]+/g, ' ')
    if (shouldTranslate(src) && cache[src]) data[key] = cache[src]
  }
  return data
}

export function writeMergedOutput(original, cache) {
  const out = rt().P.MERGED
  saveJson(out, applyCache(original, cache), false)
  console.log(`Exported ${path.basename(out)} (optional; game uses NDJSON directly)`)
}
