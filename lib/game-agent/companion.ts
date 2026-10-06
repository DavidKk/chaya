export const COMPANION_CHARACTERS = ['nagi', 'rin', 'rei', 'koto', 'yui', 'towa'] as const
export type CompanionCharacter = (typeof COMPANION_CHARACTERS)[number]
export type CompanionCue = 'danger' | 'battle' | 'chest'

export const COMPANION_CHARACTER_PROFILES: Record<CompanionCharacter, { name: string; style: string }> = {
  nagi: { name: 'Nagi', style: 'gentle, calm, and reassuring' },
  rin: { name: 'Rin', style: 'playful, quick-witted, and lightly teasing without insulting the player' },
  rei: { name: 'Rei', style: 'cool-headed, strategic, and concise' },
  koto: { name: 'Koto', style: 'thoughtful, articulate, and attentive to dialogue and story' },
  yui: { name: 'Yui', style: 'warm, friendly, and encouraging' },
  towa: { name: 'Towa', style: 'quietly curious and a little mysterious, but grounded in observed facts' },
}

export function normalizeCompanionCharacter(value: unknown): CompanionCharacter {
  if (typeof value === 'string' && COMPANION_CHARACTERS.includes(value as CompanionCharacter)) return value as CompanionCharacter
  if (value === 'steady') return 'nagi'
  if (value === 'bright') return 'yui'
  return 'rin'
}

export type CompanionState = {
  scene?: string | null
  map?: { id?: number | null } | null
  battle?: { instanceId?: string | null } | null
  party?: Array<{ id?: number | null; hp?: number | null; mhp?: number | null }>
  nearbyEvents?: Array<{ id?: number | null; name?: string | null; sprite?: string | null; distance?: number | null }>
}

const MIN_GAP_MS = 12_000

/** Facts trigger a line; the selected character changes its wording, never the game action. */
export class CompanionTracker {
  private lastSpokeAt = -Infinity
  private readonly seenBattles = new Set<string>()
  private readonly seenChests = new Set<string>()
  private readonly warnedMembers = new Set<string>()

  observe(state: CompanionState, now = Date.now()): CompanionCue | null {
    const battleId = state.scene === 'Scene_Battle' ? state.battle?.instanceId : null
    if (battleId) {
      const danger = state.party?.some((member, index) => {
        const key = `${battleId}:${member.id ?? index}`
        if (member.hp != null && member.mhp && member.hp / member.mhp >= 0.55) this.warnedMembers.delete(key)
        return member.hp != null && member.hp > 0 && member.mhp && member.hp / member.mhp <= 0.35 && !this.warnedMembers.has(key)
      })
      if (danger && now - this.lastSpokeAt >= MIN_GAP_MS) {
        state.party?.forEach((member, index) => {
          if (member.hp != null && member.hp > 0 && member.mhp && member.hp / member.mhp <= 0.35) this.warnedMembers.add(`${battleId}:${member.id ?? index}`)
        })
        this.seenBattles.add(battleId)
        this.lastSpokeAt = now
        return 'danger'
      }
      if (!this.seenBattles.has(battleId) && now - this.lastSpokeAt >= MIN_GAP_MS) {
        this.seenBattles.add(battleId)
        this.lastSpokeAt = now
        return 'battle'
      }
      return null
    }
    if (state.scene !== 'Scene_Map' || state.map?.id == null || now - this.lastSpokeAt < MIN_GAP_MS) return null
    const chest = state.nearbyEvents?.find((event) => {
      const key = `${state.map?.id}:${event.id}`
      return (
        event.id != null &&
        event.distance != null &&
        event.distance <= 6 &&
        !this.seenChests.has(key) &&
        (/chest/i.test(event.sprite || '') || /宝箱|寶箱|chest|treasure|宝物箱|보물상자/i.test(event.name || ''))
      )
    })
    if (!chest) return null
    this.seenChests.add(`${state.map.id}:${chest.id}`)
    this.lastSpokeAt = now
    return 'chest'
  }
}

const WORDS = {
  zh: {
    names: { nagi: 'Nagi · 温柔', rin: 'Rin · 活泼', rei: 'Rei · 冷静', koto: 'Koto · 文艺', yui: 'Yui · 亲近', towa: 'Towa · 神秘' },
    lines: {
      nagi: { chest: '那边有个宝箱，我们慢慢过去看看吧。', battle: '战斗开始了，我会留意大家的状态。', danger: '有人快撑不住了，先找机会治疗吧。' },
      rin: { chest: '喂，宝箱就在那边，别装作没看见。', battle: '开打了，先看看对面什么路数。', danger: '这血量可不妙，赶紧加血！' },
      rei: { chest: '发现宝箱，先确认过去的路线。', battle: '战斗开始。先判断敌人的行动。', danger: '队员血量偏低，优先治疗或防御。' },
      koto: { chest: '那边有个宝箱，这段旅途或许有了新线索。', battle: '战斗开始了，我们留意接下来的变化。', danger: '同伴的生命正在流失，先照顾他们吧。' },
      yui: { chest: '哇，看到宝箱了吗？我们一起去看看！', battle: '开打了！我帮你留意大家的状态。', danger: '有人快没血了，我们快帮他加血！' },
      towa: { chest: '那边的宝箱……去看看吧。', battle: '战斗开始了。先观察，再行动。', danger: '这条血线很危险，得尽快处理。' },
    },
  },
  en: {
    names: { nagi: 'Nagi · Gentle', rin: 'Rin · Playful', rei: 'Rei · Strategic', koto: 'Koto · Thoughtful', yui: 'Yui · Friendly', towa: 'Towa · Curious' },
    lines: {
      nagi: {
        chest: 'There is a chest nearby. Let us take our time getting there.',
        battle: 'The fight has started. I will watch the party.',
        danger: 'Someone is low on HP. Let us heal them soon.',
      },
      rin: {
        chest: 'A chest right there. You were not going to miss it, were you?',
        battle: 'Here we go. Let us see what they can do.',
        danger: 'That HP bar looks rough. Heal, quick!',
      },
      rei: { chest: 'Chest spotted. Check the route before moving.', battle: 'Battle started. Read the enemy first.', danger: 'Low HP detected. Prioritize healing or defense.' },
      koto: {
        chest: 'A chest ahead. Perhaps this path has another story to tell.',
        battle: 'The fight begins. Let us watch how it unfolds.',
        danger: 'An ally is fading. See to them first.',
      },
      yui: { chest: 'Oh, a chest! Let us check it out together.', battle: 'A fight! I will keep an eye on everyone.', danger: 'Someone is nearly down! Let us heal them!' },
      towa: { chest: 'A chest over there... worth a closer look.', battle: 'The battle begins. Observe, then move.', danger: 'That HP is dangerously low. Act soon.' },
    },
  },
  ja: {
    names: { nagi: 'Nagi · 穏やか', rin: 'Rin · 快活', rei: 'Rei · 冷静', koto: 'Koto · 物語好き', yui: 'Yui · 親しみ', towa: 'Towa · 神秘的' },
    lines: {
      nagi: { chest: 'あそこに宝箱があるね。ゆっくり見に行こう。', battle: '戦闘が始まったね。みんなの様子を見ているよ。', danger: '仲間の HP が少ないね。回復を考えよう。' },
      rin: { chest: '宝箱が見えてるよ。まさか見逃さないよね？', battle: '戦闘だね。相手の動きを見てみよう。', danger: 'その HP はまずいよ。早く回復！' },
      rei: { chest: '宝箱を確認。まずは経路を見よう。', battle: '戦闘開始。敵の行動を見極めよう。', danger: 'HP が低い。回復か防御を優先して。' },
      koto: { chest: 'あそこに宝箱があるね。何が待っているかな。', battle: '戦いが始まったね。流れを見ていこう。', danger: '仲間が危ない。まずは助けよう。' },
      yui: { chest: 'わあ、宝箱だ！一緒に見に行こう！', battle: '戦闘だ！みんなの状態を見ておくね。', danger: '仲間の HP が少ないよ！回復しよう！' },
      towa: { chest: 'あそこに宝箱……確かめに行こう。', battle: '戦闘が始まった。まずは観察しよう。', danger: 'その HP は危険だね。急いで対処しよう。' },
    },
  },
  ko: {
    names: { nagi: 'Nagi · 다정함', rin: 'Rin · 발랄함', rei: 'Rei · 침착함', koto: 'Koto · 사려 깊음', yui: 'Yui · 친근함', towa: 'Towa · 신비로움' },
    lines: {
      nagi: { chest: '저기 보물상자가 있네. 천천히 가서 보자.', battle: '전투가 시작됐어. 동료들을 살펴볼게.', danger: '동료 체력이 낮아. 먼저 회복하자.' },
      rin: { chest: '저기 보물상자야. 설마 못 본 건 아니지?', battle: '전투다. 상대 움직임부터 보자.', danger: '그 체력은 위험해. 빨리 회복해!' },
      rei: { chest: '보물상자 확인. 먼저 경로를 살펴보자.', battle: '전투 시작. 적의 행동을 판단하자.', danger: '체력이 낮아. 회복이나 방어가 우선이야.' },
      koto: { chest: '저기 보물상자가 있어. 무엇이 기다릴까?', battle: '전투가 시작됐어. 흐름을 지켜보자.', danger: '동료가 위험해. 먼저 도와주자.' },
      yui: { chest: '와, 보물상자다! 같이 가 보자!', battle: '전투다! 내가 모두의 상태를 볼게.', danger: '동료 체력이 거의 없어! 회복하자!' },
      towa: { chest: '저기 보물상자... 확인해 보자.', battle: '전투가 시작됐어. 먼저 관찰하자.', danger: '체력이 위험해. 곧바로 대응하자.' },
    },
  },
} as const

export function companionWords(locale: string) {
  return WORDS[locale.slice(0, 2) as keyof typeof WORDS] || WORDS.en
}
