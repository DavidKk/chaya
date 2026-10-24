import { isSourceText } from '@/lib/translate/source-text'
import { readRgssScripts } from '@/services/game/rgss-archive'

import type { ExtractedTranslationItem } from '../extract-items'

/** Constant / Vocab-style assignments: Name = "..." or Module::Name = '...' */
const ASSIGN_RE = /^\s*(?:[A-Z][\w:]*::)*[A-Z]\w*\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/
/** return "Current EXP" / return '…' */
const RETURN_RE = /^\s*return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/
/** draw_text / draw_text_ex(…, "label") — last string arg is usually UI copy */
const DRAW_RE = /\bdraw_text(?:_ex)?\s*\((?:[^"'()]*|\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*?("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/
const PATHISH = /[\\/]|\.(?:rvdata2?|png|jpe?g|ogg|mp3|wav|bmp|json|txt|rb)\b|Graphics\/|Audio\/|Data\//i
const CODEISH = /&&|\|\||==|!=|\.(?:call|new|size|empty\?)\b|^\s*[\[{]|window\.|SceneManager|DataManager/

function unescapeRubyLiteral(raw: string): string {
  return raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

function consider(raw: string | undefined, script: string, found: Map<string, string>) {
  if (!raw) return
  const text = unescapeRubyLiteral(raw).trim()
  if (!text || text.length < 2 || text.length > 200) return
  if (PATHISH.test(text) || CODEISH.test(text)) return
  if (!isSourceText(text)) return
  if (!found.has(text)) found.set(text, script)
}

export type RgssScriptUiString = { src: string; script: string }

/** Collect UI-facing string constants from Scripts.rvdata(2) without executing Ruby. */
export function extractRgssScriptUiStrings(contentRoot: string): RgssScriptUiString[] {
  const found = new Map<string, string>()
  for (const script of readRgssScripts(contentRoot)) {
    const name = script.name || 'Scripts'
    for (const line of script.source.split(/\r?\n/)) {
      consider(ASSIGN_RE.exec(line)?.[1], name, found)
      consider(RETURN_RE.exec(line)?.[1], name, found)
      consider(DRAW_RE.exec(line)?.[1], name, found)
    }
  }
  return [...found].map(([src, script]) => ({ src, script }))
}

/** List rows for script constants; runtime lookup still uses seed/cache (no Scripts writeback). */
export function loadRgssScriptTranslationItems(contentRoot: string, lookup: Record<string, string>, startId = 1): ExtractedTranslationItem[] {
  return extractRgssScriptUiStrings(contentRoot).map(({ src, script }, index) => {
    const zh = lookup[src] || ''
    return {
      id: String(startId + index),
      src,
      zh,
      savedZh: zh || undefined,
      initialZh: zh || undefined,
      meta: {
        category: 'plugin',
        label: '脚本常量',
        file: `Scripts/${script}`,
        context: script,
        isHardcoded: true,
      },
    }
  })
}
