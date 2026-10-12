import type { RuntimeTool } from './runtime/types'

export const PLAYER_CARD_TOOL_NAME = 'chaya_player_card'
export const PLAYER_CARD_KINDS = ['confirm', 'choice', 'notice'] as const
export const PLAYER_CARD_TONES = ['info', 'success', 'warn'] as const

export type PlayerCardKind = (typeof PLAYER_CARD_KINDS)[number]
export type PlayerCardTone = (typeof PLAYER_CARD_TONES)[number]
/** `label` 为空时由界面按语言补「好的 / 不用了」 */
export type PlayerCardOption = { id: string; label: string }
export type PlayerCard = { kind: PlayerCardKind; text: string; title?: string; tone?: PlayerCardTone; options: PlayerCardOption[] }
export type PlayerCardAnswer = { answered: true; choice: string; label: string } | { answered: true; reply: string }

const MAX_TEXT = 300
const MAX_TITLE = 60
const MAX_LABEL = 24
const MAX_OPTIONS = 4
export const CONFIRM_OPTION_IDS = { yes: 'yes', no: 'no' } as const

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function options(value: unknown): PlayerCardOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: PlayerCardOption[] = []
  for (const [index, raw] of value.entries()) {
    const item = typeof raw === 'string' ? { label: raw } : (raw as { id?: unknown; label?: unknown } | null)
    const label = text(item?.label, MAX_LABEL)
    const id = text(item?.id, 32) || label || `option-${index + 1}`
    if (!label || seen.has(id)) continue
    seen.add(id)
    result.push({ id, label })
    if (result.length === MAX_OPTIONS) break
  }
  return result
}

/** Tool 输入与事件载荷都来自模型或网络，展示前统一收窄 */
export function parsePlayerCard(value: unknown): PlayerCard | null {
  const raw = value as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !PLAYER_CARD_KINDS.includes(raw.kind as PlayerCardKind)) return null
  const kind = raw.kind as PlayerCardKind
  const body = text(raw.text, MAX_TEXT)
  if (!body) return null
  const title = text(raw.title, MAX_TITLE)
  const tone = PLAYER_CARD_TONES.includes(raw.tone as PlayerCardTone) ? (raw.tone as PlayerCardTone) : undefined
  let picked = kind === 'notice' ? [] : options(raw.options)
  if (kind === 'choice' && picked.length < 2) return null
  if (kind === 'confirm') {
    const [yes, no] = picked
    picked = [
      { id: CONFIRM_OPTION_IDS.yes, label: yes?.label || '' },
      { id: CONFIRM_OPTION_IDS.no, label: no?.label || '' },
    ]
  }
  return { kind, text: body, ...(title ? { title } : {}), ...(tone ? { tone } : {}), options: picked }
}

/** 玩家点了卡片按钮时回复的是选项 id；也可能直接在输入框打字 */
export function playerCardAnswer(card: PlayerCard, reply: string): PlayerCardAnswer {
  const option = card.options.find((item) => item.id === reply)
  return option ? { answered: true, choice: option.id, label: option.label || option.id } : { answered: true, reply }
}

export const PLAYER_CARD_TOOL: RuntimeTool = {
  name: PLAYER_CARD_TOOL_NAME,
  groups: ['player'],
  description:
    'Show a small interactive card to the player in the chat instead of asking in plain text. kind=confirm asks a yes/no question such as offering help (choice "yes" or "no"); kind=choice offers 2-4 options; kind=notice only informs and returns at once. confirm and choice wait for the player and return { choice, label }, or { reply } when the player types instead. Write text in the player\'s language and keep it to one short sentence.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...PLAYER_CARD_KINDS] },
      text: { type: 'string', description: 'One short sentence shown on the card.' },
      title: { type: 'string', description: 'Optional short heading.' },
      tone: { type: 'string', enum: [...PLAYER_CARD_TONES], description: 'notice only: info, success or warn.' },
      options: {
        type: 'array',
        description: 'choice: 2-4 options. confirm: optional [yes label, no label].',
        items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['label'] },
      },
    },
    required: ['kind', 'text'],
  },
}
