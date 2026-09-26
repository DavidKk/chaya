/**
 * 从游戏 data/ 抽取字符串，并合并写入 *-trans.seed.json（缺 key 补空串，保留已有译文）。
 */
import fs from 'node:fs'
import path from 'node:path'

import { gameContentPath, gameContentReadPath } from '@/lib/game/content-files'
import { getResolvedFromConfig } from '@/services/game/binding'

import { runExtract } from './lib/main'

function loadExistingSeed(contentRoot: string): Record<string, string> {
  const p = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (!p) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!k.trim()) continue
      out[k] = typeof v === 'string' ? v : v == null ? '' : String(v)
    }
    return out
  } catch {
    return {}
  }
}

export type EnsureSeedResult = {
  contentRoot: string
  extractFile: string
  seedFile: string
  unique: number
  added: number
  total: number
}

/** 抽取 + 确保 seed 存在（供 Web「抽取文本」与 fill-missing 前置） */
export function extractAndEnsureSeed(): EnsureSeedResult {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后抽取')
  const contentRoot = resolved.contentRoot

  const { OUT, allStrings } = runExtract(contentRoot)
  const existing = loadExistingSeed(contentRoot)
  let added = 0
  const seed: Record<string, string> = { ...existing }
  for (const src of allStrings) {
    if (!src.trim()) continue
    if (!(src in seed)) {
      seed[src] = ''
      added += 1
    }
  }

  const seedFile = gameContentPath(contentRoot, 'seed')
  fs.writeFileSync(seedFile, `${JSON.stringify(seed)}\n`, 'utf8')

  return {
    contentRoot,
    extractFile: path.basename(OUT),
    seedFile: path.basename(seedFile),
    unique: allStrings.size,
    added,
    total: Object.keys(seed).length,
  }
}
