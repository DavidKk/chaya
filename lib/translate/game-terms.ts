import { translationSegmentContent } from './segments'

export const GAME_TERM_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type GameTermLanguage = (typeof GAME_TERM_LANGUAGES)[number]
type Term = {
  translations: Readonly<Record<GameTermLanguage, string>>
  aliases?: Partial<Record<GameTermLanguage, readonly string[]>>
  badTranslations?: Partial<Record<GameTermLanguage, readonly string[]>>
}

/** Conservative standalone game labels with explicit translations for every supported term language. */
export const GAME_TERMS: Readonly<Record<string, Term>> = {
  flame: { translations: { zh: '炎', en: 'Flame', ja: '炎', ko: '화염' }, aliases: { en: ['Fire'] } },
  lightning: { translations: { zh: '雷', en: 'Lightning', ja: '雷', ko: '번개' } },
  water: { translations: { zh: '水', en: 'Water', ja: '水', ko: '물' } },
  earth: { translations: { zh: '土', en: 'Earth', ja: '土', ko: '대지' } },
  light: { translations: { zh: '光', en: 'Light', ja: '光', ko: '빛' } },
  sword: { translations: { zh: '剑', en: 'Sword', ja: '剣', ko: '검' } },
  axe: { translations: { zh: '斧', en: 'Axe', ja: '斧', ko: '도끼' } },
  staff: { translations: { zh: '杖', en: 'Staff', ja: '杖', ko: '지팡이' } },
  bow: { translations: { zh: '弓', en: 'Bow', ja: '弓', ko: '활' } },
  gun: { translations: { zh: '枪', en: 'Gun', ja: '銃', ko: '총' } },
  claw: { translations: { zh: '爪', en: 'Claw', ja: '爪', ko: '발톱' } },
  spear: { translations: { zh: '长枪', en: 'Spear', ja: '槍', ko: '창' } },

  // System & Menu terms
  save: {
    translations: { zh: '保存', en: 'Save', ja: 'セーブ', ko: '저장' },
    aliases: { en: ['Save Game'], ja: ['セーブする'] },
    badTranslations: { zh: ['节省', '拯救', '省下', '存盘'] },
  },
  load: {
    translations: { zh: '读取', en: 'Load', ja: 'ロード', ko: '불러오기' },
    aliases: { en: ['Load Game'], ja: ['ロードする'] },
    badTranslations: { zh: ['负荷', '供电量', '负载', '装载', '加载', '装入'] },
  },
  new_game: {
    translations: { zh: '新游戏', en: 'New Game', ja: 'ニューゲーム', ko: '새 게임' },
    badTranslations: { zh: ['新的游戏', '新比赛'] },
  },
  continue: {
    translations: { zh: '继续游戏', en: 'Continue', ja: 'コンティニュー', ko: '이어하기' },
    aliases: { ja: ['つづきから'] },
    badTranslations: { zh: ['继续', '延拓'] },
  },
  options: {
    translations: { zh: '设置', en: 'Options', ja: '設定', ko: '설정' },
    aliases: { en: ['Option', 'Config', 'Settings'], ja: ['オプション'] },
    badTranslations: { zh: ['选项', '期权'] },
  },
  item: {
    translations: { zh: '道具', en: 'Item', ja: 'アイテム', ko: '아이템' },
    aliases: { en: ['Items'] },
    badTranslations: { zh: ['项目', '条款', '物件'] },
  },
  skill: {
    translations: { zh: '技能', en: 'Skill', ja: 'スキル', ko: '스킬' },
    aliases: { en: ['Skills'] },
    badTranslations: { zh: ['技术', '技能条'] },
  },
  equip: {
    translations: { zh: '装备', en: 'Equip', ja: '装備', ko: '장비' },
    aliases: { en: ['Equipment'] },
    badTranslations: { zh: ['配备', '装设'] },
  },
  status: {
    translations: { zh: '状态', en: 'Status', ja: 'ステータス', ko: '상태' },
    badTranslations: { zh: ['地位', '身分', '状况'] },
  },
  quit: {
    translations: { zh: '退出', en: 'Quit', ja: '終了', ko: '종료' },
    aliases: { en: ['Exit', 'Game Over'] },
    badTranslations: { zh: ['停止', '放弃', '离开游戏'] },
  },
  gold: {
    translations: { zh: '金币', en: 'Gold', ja: '所持金', ko: '소지금' },
    aliases: { en: ['Money'] },
    badTranslations: { zh: ['黄金', '金色'] },
  },
}

function key(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

const indexes = Object.fromEntries(GAME_TERM_LANGUAGES.map((language) => [language, new Map<string, Set<string>>()])) as Record<GameTermLanguage, Map<string, Set<string>>>
for (const [id, entry] of Object.entries(GAME_TERMS)) {
  for (const language of GAME_TERM_LANGUAGES) {
    for (const source of [entry.translations[language], ...(entry.aliases?.[language] || [])]) {
      const normalized = key(source)
      const ids = indexes[language].get(normalized) || new Set<string>()
      ids.add(id)
      indexes[language].set(normalized, ids)
    }
  }
}

/** Match complete labels only; ambiguous cross-language matches have no default translation. */
export function lookupGameTerm(source: string, targetLanguage: GameTermLanguage = 'zh', sourceLanguage?: GameTermLanguage): string | null {
  if (!GAME_TERM_LANGUAGES.includes(targetLanguage) || (sourceLanguage && !GAME_TERM_LANGUAGES.includes(sourceLanguage))) return null
  const { lead, core, trail } = translationSegmentContent(source)
  const normalized = key(core)
  const languages = sourceLanguage ? [sourceLanguage] : GAME_TERM_LANGUAGES
  const targets = new Set<string>()
  for (const language of languages) {
    for (const id of indexes[language].get(normalized) || []) targets.add(GAME_TERMS[id].translations[targetLanguage])
  }
  return targets.size === 1 ? lead + [...targets][0] + trail : null
}

/**
 * Identify and fix known flawed machine translations for game terms.
 * e.g. 'Save' translated as '节省' -> corrected to '保存'.
 * Preserves boundary wrappers, whitespace and control codes.
 */
export function fixKnownBadGameTermTranslation(source: string, currentTarget: string, targetLanguage: GameTermLanguage = 'zh'): string | null {
  if (!currentTarget || !source) return null
  const { core } = translationSegmentContent(source)
  const normalizedSource = key(core)
  for (const [_id, entry] of Object.entries(GAME_TERMS)) {
    const isMatch = GAME_TERM_LANGUAGES.some((lang) => {
      const candidates = [entry.translations[lang], ...(entry.aliases?.[lang] || [])]
      return candidates.some((cand) => key(cand) === normalizedSource)
    })
    if (!isMatch) continue
    const correctTarget = entry.translations[targetLanguage]
    if (!correctTarget) continue
    const targetContent = translationSegmentContent(currentTarget)
    const targetCoreNorm = key(targetContent.core)
    const badList = entry.badTranslations?.[targetLanguage] || []
    const isBad = badList.some((bad) => key(bad) === targetCoreNorm)
    if (isBad) {
      return targetContent.lead + correctTarget + targetContent.trail
    }
  }
  return null
}
