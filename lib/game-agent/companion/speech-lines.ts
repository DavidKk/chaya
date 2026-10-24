/**
 * Local speech variants for companion cues (T4).
 * Rematch needs game/revision/enemy evidence. Same enemy is not same place.
 * T2 origin=linked_load_context may cite a pre-load unknown playthrough; do not merge.
 * Lethal names need observed enemy->actor hpBefore>0 / hpAfter=0. Guard legal != proven.
 */

import { type CompanionCharacter, type CompanionCue, companionWords, normalizeCompanionCharacter } from '../companion'
import { type CueKind, normalizeCueKind } from './cue-schedule'
import type { MemoryEpisode, RuntimeScope } from './types'

export type SpeechSituation = 'danger' | 'battle_start' | 'battle_start_rematch_loss' | 'battle_start_rematch_win' | 'rematch' | 'chest' | 'battle_win' | 'battle_loss' | 'general'

export type SpeechMemoryOrigin = 'current_playthrough' | 'linked_load_context' | 'unknown'
export type SpeechBattleOutcome = 'win' | 'lose' | 'escape' | 'abort'

type SpeechEpisode = MemoryEpisode & {
  origin?: SpeechMemoryOrigin | 'current'
  linkedFrom?: unknown
  outcome?: SpeechBattleOutcome
}

export type SpeechFacts = {
  enemyIds?: number[]
  encounterId?: string
  abilityName?: string
  knownDefenseUseful?: boolean
  knownDisarmUseful?: boolean
  libraryGameId?: string
  dataRevision?: string
  playthroughId?: string
  origin?: SpeechMemoryOrigin
  outcome?: SpeechBattleOutcome
  /** Legal guard option only. Never treat as verified vs this foe. */
  hasLegalGuard?: boolean
}

export type SpeechRenderInput = {
  kind: CompanionCue | CueKind | string
  character: string
  locale: string
  recentEpisodes?: MemoryEpisode[]
  facts?: SpeechFacts
  scope?: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId'>
  random?: () => number
  avoidKeys?: string[]
}

export type SpeechRenderResult = {
  text: string
  situation: SpeechSituation
  lineKey: string
  evidenceRefs: string[]
  memoryOrigin?: SpeechMemoryOrigin
}

function rand(random?: () => number): number {
  return typeof random === 'function' ? random() : 0
}

export function speechLineKey(situation: SpeechSituation, index: number, text: string): string {
  return `${situation}:${index}:${text}`
}

function avoidKeyHit(avoidKeys: string[], situation: SpeechSituation, index: number, text: string): boolean {
  const lineKey = speechLineKey(situation, index, text)
  return avoidKeys.some((key) => key === lineKey || key === `${index}:${text}` || key === text)
}

function pickVariant(variants: string[], random: (() => number) | undefined, avoidKeys: string[], situation: SpeechSituation): { text: string; index: number } {
  if (variants.length === 0) return { text: '', index: 0 }
  const preferred = variants.map((text, index) => ({ text, index })).filter((item) => !avoidKeyHit(avoidKeys, situation, item.index, item.text))
  const pool = preferred.length > 0 ? preferred : variants.map((text, index) => ({ text, index }))
  const index = Math.min(pool.length - 1, Math.floor(rand(random) * pool.length))
  const chosen = pool[index]!
  return { text: chosen.text, index: chosen.index }
}

function episodeHasEnemy(episode: MemoryEpisode, enemyIds: number[]): boolean {
  if (enemyIds.length === 0) return false
  return episode.evidence.some((ev) => {
    if (ev.source.kind === 'enemy' && ev.source.id != null && enemyIds.includes(ev.source.id)) return true
    if (ev.target.kind === 'enemy' && enemyIds.includes(ev.target.id)) return true
    return false
  })
}

function isUnknownPlaythrough(id: string | undefined): boolean {
  if (!id) return true
  const normalized = id.trim().toLowerCase()
  return normalized === 'unknown' || normalized === 'unknown_playthrough'
}

function queryOriginOf(scope: SpeechFacts | SpeechRenderInput['scope']): SpeechMemoryOrigin | undefined {
  if (!scope || !('origin' in scope)) return undefined
  const origin = scope.origin
  return origin === 'current_playthrough' || origin === 'linked_load_context' || origin === 'unknown' ? origin : undefined
}

function episodeIsExplicitLinked(episode: SpeechEpisode, queryOrigin?: SpeechMemoryOrigin): boolean {
  if (queryOrigin === 'linked_load_context') return true
  if (episode.origin === 'linked_load_context') return true
  return episode.linkedFrom != null
}

/** Rematch memory must match current game / data revision / enemy ids. */
export function filterRematchEpisodes(
  episodes: MemoryEpisode[] | undefined,
  scope: SpeechFacts | SpeechRenderInput['scope'],
  enemyIds: number[] | undefined,
  limit = 3
): MemoryEpisode[] {
  if (!episodes?.length || !scope) return []
  const libraryGameId = 'libraryGameId' in scope ? scope.libraryGameId : undefined
  const dataRevision = 'dataRevision' in scope ? scope.dataRevision : undefined
  const playthroughId = 'playthroughId' in scope ? scope.playthroughId : undefined
  const queryOrigin = queryOriginOf(scope)
  if (!libraryGameId || !dataRevision) return []
  const enemies = enemyIds?.filter((id) => Number.isFinite(id)) ?? []
  if (enemies.length === 0) return []

  return episodes
    .filter((episode) => {
      if (episode.scope.libraryGameId !== libraryGameId) return false
      if (episode.scope.dataRevision !== dataRevision) return false
      if (!episodeHasEnemy(episode, enemies)) return false
      if (playthroughId && episode.scope.playthroughId === playthroughId && !isUnknownPlaythrough(playthroughId)) {
        return true
      }
      // Explicit T2 linked_load_context only; unknown playthrough is not a wildcard.
      return episodeIsExplicitLinked(episode as SpeechEpisode, queryOrigin)
    })
    .slice(0, limit)
}

function isLinkedLoadSpeech(episode: SpeechEpisode | undefined, _currentPlaythrough: string | undefined, queryOrigin?: SpeechMemoryOrigin): boolean {
  return !!episode && episodeIsExplicitLinked(episode, queryOrigin)
}

/** Only an observed enemy->actor kill (hpBefore>0, hpAfter=0) may name the lethal skill. */
export function lethalAbilityName(episode: MemoryEpisode | undefined): string | undefined {
  if (!episode) return undefined
  for (const evidence of episode.evidence) {
    if (evidence.attribution !== 'observed_action') continue
    if (evidence.source.kind !== 'enemy') continue
    if (evidence.target.kind !== 'actor') continue
    if (evidence.hpBefore == null || evidence.hpBefore <= 0) continue
    if (evidence.hpAfter !== 0) continue
    const name = evidence.ability?.name?.trim()
    if (name) return name
  }
  return undefined
}

function structuredOutcome(episode: MemoryEpisode | undefined, facts?: SpeechFacts): SpeechBattleOutcome | undefined {
  const fromFacts = facts?.outcome
  if (fromFacts === 'win' || fromFacts === 'lose' || fromFacts === 'escape' || fromFacts === 'abort') return fromFacts
  const fromEpisode = (episode as SpeechEpisode | undefined)?.outcome
  if (fromEpisode === 'win' || fromEpisode === 'lose' || fromEpisode === 'escape' || fromEpisode === 'abort') return fromEpisode
  return undefined
}

function hasVerifiedPartyKnockout(episode: MemoryEpisode | undefined): boolean {
  if (!episode) return false
  return episode.evidence.some((ev) => ev.attribution === 'observed_action' && ev.target.kind === 'actor' && ev.hpBefore != null && ev.hpBefore > 0 && ev.hpAfter === 0)
}

function rematchAdvice(locale: string, facts: SpeechFacts | undefined, abilityName?: string): string {
  const lang = locale.slice(0, 2)
  const trialGuard = facts?.hasLegalGuard === true || facts?.knownDefenseUseful === true
  const trialDisarm = facts?.knownDisarmUseful === true

  if (lang === 'zh') {
    if (trialDisarm) return '如果现在能封住它，可以试着打断，看看实际效果。'
    if (trialGuard) return '这回可以试着先防御，看看能不能稳住。'
    return abilityName ? `先留意【${abilityName}】的出手时机，我陪你找机会。` : '先看看它怎么出手，我们稳一点。'
  }
  if (lang === 'ja') {
    if (trialDisarm) return '今封じる手段があるなら、試して反応を見よう。'
    if (trialGuard) return '今度は防御を試して、しのげるか見てみよう。'
    return abilityName ? `【${abilityName}】のタイミングを見よう。一緒に隙を探そう。` : 'まず相手の動きを見よう。焦らずいこう。'
  }
  if (lang === 'ko') {
    if (trialDisarm) return '지금 봉인할 수 있다면 한번 시도하고 반응을 보자.'
    if (trialGuard) return '이번엔 먼저 방어해서 버틸 수 있는지 보자.'
    return abilityName ? `【${abilityName}】 타이밍을 보자. 같이 기회를 찾자.` : '먼저 움직임을 보자. 차분하게 가면 돼.'
  }
  if (trialDisarm) return 'If a seal is available now, we could try it and watch how they respond.'
  if (trialGuard) return 'We could try guarding first and see whether that helps us hold on.'
  return abilityName ? `Watch for 【${abilityName}】. We will look for an opening together.` : 'Let us watch their moves and take this steadily.'
}

function preLoadLabel(locale: string): string {
  const lang = locale.slice(0, 2)
  if (lang === 'zh') return '读档前那次'
  if (lang === 'ja') return 'ロード前のあの時'
  if (lang === 'ko') return '로드 전 그 번'
  return 'that pre-load fight'
}

function priorLabel(locale: string, preLoad: boolean): string {
  if (preLoad) return preLoadLabel(locale)
  const lang = locale.slice(0, 2)
  if (lang === 'zh') return '上次'
  if (lang === 'ja') return '前回'
  if (lang === 'ko') return '지난번'
  return 'last time'
}

function rematchLossLines(
  character: CompanionCharacter,
  locale: string,
  abilityName: string | undefined,
  facts: SpeechFacts | undefined,
  preLoad: boolean,
  hasKnockout: boolean
): string[] {
  const advice = rematchAdvice(locale, facts, abilityName)
  const lang = locale.slice(0, 2)
  const skill = abilityName ? `【${abilityName}】` : ''
  const when = priorLabel(locale, preLoad)

  if (lang === 'zh') {
    const base = abilityName
      ? [`又是这家伙。${when}${skill}打倒过同伴。${advice}`, `小心，${when}就是被${skill}击倒的。${advice}`, `再遇了。记录显示${when}${skill}曾造成击倒。${advice}`]
      : hasKnockout
        ? [`又是这家伙。${when}有过击倒记录。${advice}`, `再遇到了，先按${when}的击倒记录稳住。${advice}`]
        : [`又是这家伙。${when}这轮战败过。${advice}`, `再遇到了，先按${when}的战败记录稳住。${advice}`]
    if (character === 'rei') return base.map((line) => line.replace('又是这家伙。', '目标确认。').replace('又是这家伙，', '目标确认，'))
    if (character === 'rin') return base
    if (character === 'yui') return base.map((line) => `嗯…${line}`)
    return base
  }

  if (lang === 'ja') {
    if (abilityName) return [`またこの相手だ。${when}は${skill}で倒された。${advice}`, `注意。${when}の記録では${skill}が危険だった。${advice}`]
    return hasKnockout ? [`またこの相手だ。${when}は撃破された記録がある。${advice}`] : [`またこの相手だ。${when}は敗北している。${advice}`]
  }
  if (lang === 'ko') {
    if (abilityName) return [`또 이 상대야. ${when} ${skill}에 쓰러졌어. ${advice}`, `조심해. ${when} 기록상 ${skill}이 위험했어. ${advice}`]
    return hasKnockout ? [`또 만났어. ${when} 쓰러진 기록이 있어. ${advice}`] : [`또 만났어. ${when} 패배한 기록이 있어. ${advice}`]
  }

  if (abilityName) {
    return [`Same foe. ${when} ${skill} scored a knockout. ${advice}`, `Careful — records show ${when} ${skill} dropped us. ${advice}`]
  }
  return hasKnockout ? [`Same foe. ${when} we recorded a knockout. ${advice}`] : [`Same foe. ${when} this fight was a loss. ${advice}`]
}

function rematchWinLines(locale: string, preLoad: boolean): string[] {
  const lang = locale.slice(0, 2)
  const when = priorLabel(locale, preLoad)
  if (lang === 'zh') {
    return preLoad
      ? [`又见面了。${when}赢过，仍先观察，不把周目混在一起。`, `再遇了。${when}有过胜利记录，也不合并到本周目。`]
      : [`又见面了。${when}拿走过胜利，先按稳的来。`, `再遇到了，${when}有过成功经验，仍先观察。`]
  }
  if (lang === 'ja') return [`また会ったね。${when}は勝っているけど、周回は混ぜない。油断しないで。`]
  if (lang === 'ko') return [`또 만났네. ${when}엔 이겼지만 주회를 합치지 말자.`]
  return [`We beat them ${when}, but stay sharp. Do not merge playthroughs.`, `Familiar foe. Prior win or not, read them first.`]
}

function rematchWatchLines(locale: string, preLoad: boolean): string[] {
  const lang = locale.slice(0, 2)
  const when = priorLabel(locale, preLoad)
  if (lang === 'zh') {
    return preLoad
      ? [`又见面了。${when}交过手，先当新的一轮观察，不合并周目。`, `再遇到了。这是${when}的对手，先看清再动手。`]
      : ['又见面了，先看清这轮再动手。', '再遇到了，先观察，别假定旧经验仍适用。']
  }
  if (lang === 'ja') return preLoad ? [`また会ったね。${when}の相手だ。周回は混ぜず、まず観察。`] : ['また会ったね。まずは様子を見よう。']
  if (lang === 'ko') return preLoad ? [`또 만났네. ${when}의 상대야. 주회를 합치지 말고 먼저 보자.`] : ['또 만났네. 이번 라운드부터 다시 보자.']
  return preLoad
    ? [`Same foe from ${when}. Observe again; do not merge playthroughs.`]
    : ['Familiar foe. Read this fight first.', 'Same foe again. Do not assume the last ground still applies.']
}

function fallbackLine(kind: CueKind, character: CompanionCharacter, locale: string): string {
  const words = companionWords(locale)
  const lines = words.lines[character]
  if (kind === 'danger') return lines.danger
  if (kind === 'battle_start') return lines.battle
  if (kind === 'chest') return lines.chest
  if (kind === 'battle_win') {
    const lang = locale.slice(0, 2)
    if (lang === 'zh') return '漂亮，这场拿下了。'
    if (lang === 'ja') return 'よし、勝利だね。'
    if (lang === 'ko') return '좋아, 이겼어.'
    return 'Nice — we took that fight.'
  }
  if (kind === 'battle_loss') {
    const lang = locale.slice(0, 2)
    if (lang === 'zh') return '先记下这次，回读档后再说。'
    if (lang === 'ja') return '今回は記録しておく。ロードしてからまた考えよう。'
    if (lang === 'ko') return '이번 건 기록해 두자. 로드한 뒤 다시 보자.'
    return 'Logged for now. We can rethink after a reload.'
  }
  const lang = locale.slice(0, 2)
  if (lang === 'zh') return '我在旁边看着，继续。'
  if (lang === 'ja') return 'そばで見てるよ。続けて。'
  if (lang === 'ko') return '옆에서 보고 있을게. 계속하자.'
  return 'I am right here. Keep going.'
}

function dangerVariants(character: CompanionCharacter, locale: string): string[] {
  const base = fallbackLine('danger', character, locale)
  const lang = locale.slice(0, 2)
  if (lang === 'zh') {
    return [base, '血线危险，先处理生存。', '有人快撑不住了，优先保命。']
  }
  if (lang === 'ja') return [base, 'HP が危ない。生存を優先して。']
  if (lang === 'ko') return [base, '체력이 위험해. 생존부터 하자.']
  return [base, 'HP is critical. Stabilize first.']
}

function battleStartVariants(character: CompanionCharacter, locale: string): string[] {
  const base = fallbackLine('battle_start', character, locale)
  const lang = locale.slice(0, 2)
  if (lang === 'zh') return [base, '战斗开始，先看清对面。', '开打了，先观察再动手。']
  if (lang === 'ja') return [base, '戦闘開始。まず相手を見よう。']
  if (lang === 'ko') return [base, '전투 시작. 상대부터 보자.']
  return [base, 'Battle start. Read them first.']
}

function chestVariants(character: CompanionCharacter, locale: string): string[] {
  const base = fallbackLine('chest', character, locale)
  const lang = locale.slice(0, 2)
  if (lang === 'zh') return [base, '附近有可互动的奖励物件。', '那边有未开启的奖励，留意一下。']
  if (lang === 'ja') return [base, '近くに報酬オブジェクトがあるよ。']
  if (lang === 'ko') return [base, '근처에 보상 오브젝트가 있어.']
  return [base, 'A reward object is nearby.']
}

export function resolveSpeechSituation(kind: string, rematchEpisodes: MemoryEpisode[], facts?: SpeechFacts): SpeechSituation {
  const normalized = normalizeCueKind(kind)
  if (normalized === 'danger') return 'danger'
  if (normalized === 'chest') return 'chest'
  if (normalized === 'battle_win') return 'battle_win'
  if (normalized === 'battle_loss') return 'battle_loss'
  if (normalized === 'battle_start' || normalized === 'rematch' || kind === 'battle') {
    const top = rematchEpisodes[0]
    const outcome = structuredOutcome(top, facts)
    if (outcome === 'lose' || hasVerifiedPartyKnockout(top)) return 'battle_start_rematch_loss'
    if (outcome === 'win') return 'battle_start_rematch_win'
    if (top || normalized === 'rematch') return 'rematch'
    return 'battle_start'
  }
  return 'general'
}

export function renderSpeechLine(input: SpeechRenderInput): SpeechRenderResult {
  const character = normalizeCompanionCharacter(input.character)
  const kind = normalizeCueKind(input.kind)
  const facts = input.facts ?? {}
  const scope = {
    libraryGameId: input.scope?.libraryGameId ?? facts.libraryGameId,
    dataRevision: input.scope?.dataRevision ?? facts.dataRevision,
    playthroughId: input.scope?.playthroughId ?? facts.playthroughId,
    origin: facts.origin,
  }
  const rematchEpisodes = filterRematchEpisodes(input.recentEpisodes, scope, facts.enemyIds)
  const situation = resolveSpeechSituation(input.kind, rematchEpisodes, facts)
  const top = rematchEpisodes[0] as SpeechEpisode | undefined
  const verifiedLethal = lethalAbilityName(top)
  const abilityName = verifiedLethal
  const preLoad = isLinkedLoadSpeech(top, scope.playthroughId, facts.origin)
  const evidenceRefs = top ? [top.episodeId, ...top.evidence.map((item) => item.actionId)].filter(Boolean) : []

  let variants: string[]
  switch (situation) {
    case 'danger':
      variants = dangerVariants(character, input.locale)
      break
    case 'chest':
      variants = chestVariants(character, input.locale)
      break
    case 'battle_start_rematch_loss':
      variants = rematchLossLines(character, input.locale, abilityName, facts, preLoad, hasVerifiedPartyKnockout(top))
      break
    case 'battle_start_rematch_win':
      variants = rematchWinLines(input.locale, preLoad)
      break
    case 'rematch':
      variants = rematchWatchLines(input.locale, preLoad)
      break
    case 'battle_start':
      variants = battleStartVariants(character, input.locale)
      break
    default:
      variants = [fallbackLine(kind, character, input.locale)]
      break
  }

  const chosen = pickVariant(variants, input.random, input.avoidKeys ?? [], situation)
  return {
    text: chosen.text || fallbackLine(kind, character, input.locale),
    situation,
    lineKey: speechLineKey(situation, chosen.index, chosen.text),
    evidenceRefs,
    memoryOrigin: preLoad ? 'linked_load_context' : top ? 'current_playthrough' : facts.origin,
  }
}
