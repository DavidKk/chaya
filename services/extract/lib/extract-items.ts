import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { translationSources } from '@/lib/translate/segments'
import { loadGameTranslateLookup } from '@/services/translate/game-lookup'

import { loadGameLocalesCatalog, normalizeLocalesKey } from './game-locales'

export type ExtractedTextCategory =
  | 'dialogue'
  | 'story'
  | 'choice'
  | 'item'
  | 'item_desc'
  | 'weapon'
  | 'weapon_desc'
  | 'armor'
  | 'armor_desc'
  | 'skill'
  | 'skill_desc'
  | 'enemy'
  | 'actor'
  | 'actor_nickname'
  | 'actor_profile'
  | 'state'
  | 'state_msg'
  | 'map'
  | 'system'
  | 'plugin'
  | 'resource'
  | 'other'

export type ExtractedItemMeta = {
  category: ExtractedTextCategory
  label: string
  speaker?: string
  context?: string
  file?: string
  localesKey?: string
  localesFile?: string
}

export type ExtractedTranslationItem = {
  id: string
  src: string
  zh: string
  savedZh?: string
  initialZh?: string
  meta: ExtractedItemMeta
}

export type ExtractedLocalesMeta = {
  hasLocales: boolean
  availableLanguages: string[]
  currentSourceLang: string
  currentTargetLang: string
  primaryLanguage: string
}

export type ExtractedItemsResult = {
  items: ExtractedTranslationItem[]
  locales?: ExtractedLocalesMeta
}

export function loadExtractedItemsWithLocales(contentRoot: string, opts?: { sourceLang?: string; targetLang?: string }): ExtractedItemsResult {
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  const extractPath = gameContentReadPath(contentRoot, 'extractStrings', { alsoParent: true })

  let seed: Record<string, string> = {}
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Record<string, string>
    } catch {
      seed = {}
    }
  }

  let extractData: any = null
  if (extractPath && fs.existsSync(extractPath)) {
    try {
      extractData = JSON.parse(fs.readFileSync(extractPath, 'utf8'))
    } catch {
      extractData = null
    }
  }

  // Load game locales catalog if present
  const catalog = loadGameLocalesCatalog(contentRoot)
  let currentSourceLang = ''
  let currentTargetLang = ''

  if (catalog.hasLocales) {
    if (opts?.sourceLang && catalog.languages.includes(opts.sourceLang)) {
      currentSourceLang = opts.sourceLang
    } else if (catalog.languages.includes('en')) {
      currentSourceLang = 'en'
    } else {
      currentSourceLang = catalog.primaryLanguage || catalog.languages[0] || ''
    }

    if (opts?.targetLang) {
      currentTargetLang = opts.targetLang
    } else if (catalog.languages.includes('ch')) {
      currentTargetLang = 'ch'
    } else if (catalog.languages.includes('zh')) {
      currentTargetLang = 'zh'
    } else if (catalog.languages.includes('zh-cn')) {
      currentTargetLang = 'zh-cn'
    } else {
      currentTargetLang = ''
    }
  }

  const metaMap = new Map<string, ExtractedItemMeta>()

  function record(text: unknown, meta: ExtractedItemMeta) {
    if (typeof text !== 'string' || !text) return
    const raw = text.trim()
    if (raw && !metaMap.has(raw)) {
      metaMap.set(raw, meta)
    }
    for (const part of translationSources(text)) {
      const k = part.trim()
      if (!k) continue
      if (!metaMap.has(k)) {
        metaMap.set(k, meta)
      }
    }
  }

  function isSystemPrompt(text: string): boolean {
    if (typeof text !== 'string') return false
    const t = text.trim()
    if (/^[+-]\s*[\{\[\<]?.+[\}\]\>]?/.test(t)) return true
    if (/^SystemText-\d+$/i.test(t)) return true
    if (/(?:手に入れた|入手|獲得|失った|消費|残高|所持金|ゴールド|\bEXP\b|\bHP\b|\bMP\b|\bTP\b)/i.test(t)) return true
    if (/(?:获得|得到|失去了|消耗|金币|经验值|持有金|系统提示|已保存|保存完毕)/.test(t)) return true
    if (/(?:gained|obtained|lost|item received|gold received)/i.test(t)) return true
    return false
  }

  function isEngineEventId(name: string): boolean {
    return /^(?:EV\d+|Event_?\d+|CommonEvent\d+|__auto_\w+|宝箱|Door|Chest|Transfer|Save|Point|Light|SE|BGM|Object|Trap|Trigger)$/i.test(name.trim())
  }

  function cleanSpeaker(face?: string, speaker?: string): string | undefined {
    if (speaker && speaker.trim() && !isEngineEventId(speaker)) {
      return speaker.trim()
    }
    if (face && face.trim()) {
      const f = face.trim()
      return f.replace(/^\d+([A-Za-z\u4e00-\u9fa5\u3040-\u30ff])/, '$1')
    }
    return undefined
  }

  if (extractData) {
    // 1. Dialogue & Events
    for (const block of extractData.dialogue || []) {
      const mapNum = block.map != null ? (typeof block.map === 'number' ? block.map : parseInt(String(block.map), 10)) : undefined
      const mapFile = mapNum != null && !Number.isNaN(mapNum) ? `data/Map${String(mapNum).padStart(3, '0')}.json` : block.map ? `data/Map${block.map}.json` : undefined
      const file = mapFile || (block.src === 'common' ? 'data/CommonEvents.json' : block.src === 'troop' ? 'data/Troops.json' : undefined)
      const context = block.map ? `地图 ${block.map}` : block.src === 'common' ? '公共事件' : block.src === 'troop' ? '战斗事件' : undefined

      if (block.kind === 'c') {
        const speaker = cleanSpeaker(block.face, block.speaker)
        for (const c of block.choices || []) {
          record(c, { category: 'choice', label: '选项', speaker, context, file })
        }
      } else {
        const lines = Array.isArray(block.lines) ? block.lines : typeof block.src === 'string' ? [block.src] : []
        const fullText = lines.join('\n')

        const registerText = (text: string) => {
          if (!text || typeof text !== 'string') return
          const trimmed = text.trim()
          if (!trimmed) return

          if (isSystemPrompt(trimmed)) {
            record(text, { category: 'system', label: '系统文案', context, file })
            return
          }

          const hasDialogueQuote = /(?:^[「『"“]|【[^】]+】)/.test(trimmed)
          const isDialogue = Boolean(block.face || block.speaker || hasDialogueQuote)

          if (isDialogue) {
            const speaker = cleanSpeaker(block.face, block.speaker)
            const label = speaker ? `对话 (${speaker})` : '对话'
            record(text, { category: 'dialogue', label, speaker, context, file })
          } else {
            const label = block.kind === 's' ? '滚动字幕' : '剧情/旁白'
            record(text, { category: 'story', label, context, file })
          }
        }

        registerText(fullText)
        for (const line of lines) {
          registerText(line)
        }
      }
    }

    // 2. Database
    const db = extractData.db || {}
    for (const item of db.items || []) {
      record(item.name, { category: 'item', label: '物品', file: 'data/Items.json', context: item.name })
      record(item.description, { category: 'item_desc', label: '物品说明', file: 'data/Items.json', context: item.name })
    }
    for (const item of db.weapons || []) {
      record(item.name, { category: 'weapon', label: '武器', file: 'data/Weapons.json', context: item.name })
      record(item.description, { category: 'weapon_desc', label: '武器说明', file: 'data/Weapons.json', context: item.name })
    }
    for (const item of db.armors || []) {
      record(item.name, { category: 'armor', label: '防具', file: 'data/Armors.json', context: item.name })
      record(item.description, { category: 'armor_desc', label: '防具说明', file: 'data/Armors.json', context: item.name })
    }
    for (const item of db.skills || []) {
      record(item.name, { category: 'skill', label: '技能', file: 'data/Skills.json', context: item.name })
      record(item.description, { category: 'skill_desc', label: '技能说明', file: 'data/Skills.json', context: item.name })
    }
    for (const item of db.enemies || []) {
      record(item.name, { category: 'enemy', label: '敌人', file: 'data/Enemies.json', context: item.name })
    }
    for (const item of db.actors || []) {
      record(item.name, { category: 'actor', label: '角色名', file: 'data/Actors.json', context: item.name })
      record(item.nickname, { category: 'actor_nickname', label: '角色称号', file: 'data/Actors.json', context: item.name })
      record(item.profile, { category: 'actor_profile', label: '角色背景', file: 'data/Actors.json', context: item.name })
    }
    for (const item of db.states || []) {
      record(item.name, { category: 'state', label: '状态', file: 'data/States.json', context: item.name })
      record(item.message1, { category: 'state_msg', label: '状态提示', file: 'data/States.json', context: item.name })
      record(item.message2, { category: 'state_msg', label: '状态提示', file: 'data/States.json', context: item.name })
    }
    for (const item of db.maps || []) {
      record(item.name, { category: 'map', label: '地名', file: 'data/MapInfos.json', context: `地图 ${item.id}` })
    }
    for (const s of db.system || []) {
      record(s, { category: 'system', label: '系统文案', file: 'data/System.json' })
    }
    for (const p of db.plugins || []) {
      record(p, { category: 'plugin', label: '插件参数', file: 'js/plugins.js' })
    }
    for (const r of db.resources || []) {
      record(r, { category: 'resource', label: '文本资源' })
    }
  }

  // Load current local lookup (which includes cache.ndjson taking precedence over seed)
  const lookup = loadGameTranslateLookup(contentRoot)

  const items: ExtractedTranslationItem[] = []
  let index = 0
  const seen = new Set<string>()

  // Helper to resolve an extracted raw string to natural language & locales metadata
  function resolveTextAndMeta(
    rawText: string,
    baseMeta?: ExtractedItemMeta
  ): {
    src: string
    zh: string
    meta: ExtractedItemMeta
  } {
    const meta: ExtractedItemMeta = baseMeta ? { ...baseMeta } : { category: 'other', label: '其他文本' }
    let finalSrc = rawText
    let targetZh = ''

    if (catalog.hasLocales) {
      const normKey = normalizeLocalesKey(rawText)
      const hasKeyInLocales = Boolean(
        catalog.keyToFileMap[normKey] ||
        catalog.keyToFileMap[rawText] ||
        catalog.dictionaries[currentSourceLang]?.[normKey] ||
        catalog.dictionaries[catalog.primaryLanguage]?.[normKey] ||
        /^(?:Map\d+|CommonEvent|HINT|GOS|Actor|Item|Skill)/i.test(normKey)
      )

      if (hasKeyInLocales) {
        meta.localesKey = normKey
        const foundFile = catalog.keyToFileMap[normKey] || catalog.keyToFileMap[rawText]
        if (foundFile) {
          meta.localesFile = foundFile
        }

        // Resolve source natural language text
        const localizedSrc =
          (currentSourceLang && catalog.dictionaries[currentSourceLang]?.[normKey]) ||
          (catalog.primaryLanguage && catalog.dictionaries[catalog.primaryLanguage]?.[normKey]) ||
          catalog.dictionaries['en']?.[normKey] ||
          catalog.dictionaries['ru']?.[normKey]

        if (localizedSrc) {
          finalSrc = localizedSrc
        }

        // Resolve target natural language text from catalog if target language exists
        if (currentTargetLang && catalog.dictionaries[currentTargetLang]?.[normKey]) {
          targetZh = catalog.dictionaries[currentTargetLang][normKey]
        }
      }
    }

    if (!meta.file) {
      const mapMatch = rawText.match(/^(?:\{)?(Map\d+)/i)
      if (mapMatch) {
        meta.file = `data/${mapMatch[1]}.json`
      }
    }

    return {
      src: finalSrc,
      zh: targetZh,
      meta,
    }
  }

  for (const [src, seedZh] of Object.entries(seed)) {
    index++
    seen.add(src)
    const baseMeta = metaMap.get(src)
    const resolved = resolveTextAndMeta(src, baseMeta)

    const currentZh = resolved.zh || lookup[resolved.src] || lookup[src] || seedZh || ''
    items.push({
      id: String(index),
      src: resolved.src,
      zh: currentZh,
      savedZh: currentZh || undefined,
      initialZh: currentZh || undefined,
      meta: resolved.meta,
    })
  }

  for (const [src, meta] of metaMap.entries()) {
    if (seen.has(src)) continue
    index++
    seen.add(src)
    const resolved = resolveTextAndMeta(src, meta)

    const currentZh = resolved.zh || lookup[resolved.src] || lookup[src] || ''
    items.push({
      id: String(index),
      src: resolved.src,
      zh: currentZh,
      savedZh: currentZh || undefined,
      initialZh: currentZh || undefined,
      meta: resolved.meta,
    })
  }

  // If no items were extracted from seed/extractStrings, but game has locales catalog:
  if (items.length === 0 && catalog.hasLocales) {
    const keys = Object.keys(catalog.keyToFileMap)
    for (const key of keys) {
      index++
      const file = catalog.keyToFileMap[key]
      let category: ExtractedTextCategory = 'other'
      let label = '本地化文本'

      if (/^Map\d+/i.test(key)) {
        category = 'story'
        label = '剧情/旁白'
      } else if (/^HINT/i.test(key)) {
        category = 'system'
        label = '系统提示'
      } else if (/^(?:Item|Weapon|Armor)/i.test(key)) {
        category = 'item'
        label = '物品道具'
      } else if (/^Skill/i.test(key)) {
        category = 'skill'
        label = '技能'
      } else if (/^Actor/i.test(key)) {
        category = 'actor'
        label = '角色'
      } else if (/^GOS/i.test(key)) {
        category = 'story'
        label = '剧情说明'
      }

      const meta: ExtractedItemMeta = {
        category,
        label,
        localesKey: key,
        localesFile: file,
        file: file ? `locales/${currentSourceLang || catalog.primaryLanguage || 'en'}/${file}` : undefined,
        context: key,
      }

      const candidateSrc =
        (currentSourceLang && catalog.dictionaries[currentSourceLang]?.[key]) ||
        (catalog.primaryLanguage && catalog.dictionaries[catalog.primaryLanguage]?.[key]) ||
        catalog.dictionaries['en']?.[key] ||
        catalog.dictionaries['ru']?.[key] ||
        key

      const candidateZh = currentTargetLang ? catalog.dictionaries[currentTargetLang]?.[key] : ''
      const finalZh = candidateZh || lookup[candidateSrc] || lookup[key] || ''

      items.push({
        id: String(index),
        src: candidateSrc,
        zh: finalZh,
        savedZh: finalZh || undefined,
        initialZh: finalZh || undefined,
        meta,
      })
    }
  }

  return {
    items,
    locales: catalog.hasLocales
      ? {
          hasLocales: true,
          availableLanguages: catalog.languages,
          currentSourceLang,
          currentTargetLang,
          primaryLanguage: catalog.primaryLanguage,
        }
      : undefined,
  }
}

export function loadExtractedItems(contentRoot: string): ExtractedTranslationItem[] {
  return loadExtractedItemsWithLocales(contentRoot).items
}
