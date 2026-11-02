import type { MapEventInfo, MapEventType } from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'

export const TYPE_KEY: Record<MapEventType, MessageKey> = {
  npc: 'events.map.typeNpc',
  transfer: 'events.map.typeTransfer',
  chest: 'events.map.typeChest',
  trigger: 'events.map.typeTrigger',
  other: 'events.map.typeOther',
}

export type EventState = { kind: 'shown' | 'hidden' | 'unknown'; page: number; exact: boolean }

export function isGenericEventName(name?: string | null): boolean {
  if (!name) return true
  const n = name.trim()
  return /^(?:ev(?:ent)?)[-_]?\d+$/i.test(n) || /^\d+$/.test(n)
}

export function isSystemEventName(name?: string | null): boolean {
  if (!name) return false
  return /^(?:door|gate|chest|box|transfer|move|tp|teleport|warp|exit|enter|bgm|bgs|se|me|sound|music|light|shadow|fog|weather|timer|parallel|autorun|auto|trigger|trap|switch|save|crystal|stone|sign|board|item|gold|shop_trigger|门|宝箱|箱|传送|切换|出口|入口|背景音|音乐|音效|光影|天气|时间|并行|自动|陷阱|开关|保存点|存档点|水晶|石碑|告示牌|标牌|掉落物)$/i.test(
    name.trim()
  )
}

export function cleanGraphicName(graphic?: string | null): string {
  if (!graphic) return ''
  return graphic
    .replace(/^[!$]+/, '')
    .replace(/^\d+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

export type NpcResolvedInfo = {
  name: string
  rawName: string
  hasRealName: boolean
  isGeneric: boolean
  dialogueSnippet?: string
  speaker?: string
  faceName?: string
  characterName?: string
}

function pageConditionActor(ev: MapEventInfo, actorNames?: readonly string[]): string | undefined {
  if (!actorNames?.length) return undefined
  for (const page of ev.pages) {
    if (page.conditions.actor && actorNames[page.conditions.actor]) {
      return actorNames[page.conditions.actor]
    }
  }
}

export function resolveNpcInfo(ev: MapEventInfo, texts?: Record<string, string>, actorNames?: readonly string[]): NpcResolvedInfo {
  const rawName = (ev.name || ev.rawName || '').trim()
  const isGeneric = isGenericEventName(rawName)
  const explicitName = !isGeneric ? rawName : ''
  let speakerName = ''
  let nameTagName = ''
  let commentName = ''
  let faceGraphic = ''
  let charGraphic = ''
  let dialogueSnippet = ''

  for (const page of ev.pages || []) {
    if (page.characterName && !charGraphic && !page.characterName.startsWith('!')) {
      charGraphic = page.characterName
    }
    for (const cmd of page.list || []) {
      if (cmd.code === 101) {
        if (cmd.parameters?.[0] && !faceGraphic) {
          faceGraphic = String(cmd.parameters[0])
        }
        if (typeof cmd.parameters?.[4] === 'string' && cmd.parameters[4].trim()) {
          const spk = cmd.parameters[4].trim()
          speakerName = texts?.[spk] || spk
        }
      } else if (cmd.code === 401) {
        const rawLine = String(cmd.parameters?.[0] || '').trim()
        const line = texts?.[rawLine] || rawLine

        const yanfly = line.match(/\\(?:[nN]|[nN]c|[nN]r|[nN]m|[nN]ame)<([^>]+)>/)
        if (yanfly && !nameTagName) nameTagName = yanfly[1].trim()

        const actorRef = line.match(/\\(?:[nN]|[nN]c|[nN]r|[nN]m|[nN]ame)\[(\d+)\]/)
        if (actorRef && !nameTagName && actorNames?.[Number(actorRef[1])]) {
          nameTagName = actorNames[Number(actorRef[1])]
        }

        const bracket = line.match(/^[【「『《]([^】」』》\n]{1,20})[】」』》]/)
        if (bracket && !nameTagName) nameTagName = bracket[1].trim()

        const square = line.match(/^\[([^\]\n]{1,20})\]/)
        if (square && !nameTagName && !square[1].startsWith('{') && !square[1].startsWith('\\')) {
          nameTagName = square[1].trim()
        }

        const colon = line.match(/^([^\s:：\\\/\[\]{}]{1,16})[：:](?!\/\/|\d)/)
        if (colon && !nameTagName) nameTagName = colon[1].trim()

        if (!dialogueSnippet && line && !line.startsWith('+') && !line.startsWith('{')) {
          const clean = line
            .replace(/\\(?:[nN]|[nN]c|[nN]r|[nN]m|[nN]ame)<[^>]+>/g, '')
            .replace(/^[【「\[『《][^】」\]』》]+[】」\]』》]/, '')
            .replace(/^[^\s:：\\\/]{1,16}[：:]/, '')
            .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?/g, '')
            .trim()
          if (clean) dialogueSnippet = clean
        }
      } else if (cmd.code === 108 || cmd.code === 408) {
        const comment = String(cmd.parameters?.[0] || '')
        const tag = comment.match(/<(?:name|npc|speaker|title|chara):\s*([^>]+)>/i)
        if (tag && !commentName) commentName = tag[1].trim()
      }
    }
  }

  const actorMatch = pageConditionActor(ev, actorNames)
  const hasRealName = Boolean(speakerName || nameTagName || (explicitName && !isSystemEventName(explicitName)) || commentName || actorMatch)

  const name = speakerName || nameTagName || explicitName || commentName || actorMatch || cleanGraphicName(faceGraphic) || cleanGraphicName(charGraphic) || rawName || `#${ev.id}`

  return {
    name,
    rawName,
    hasRealName,
    isGeneric,
    speaker: speakerName || nameTagName,
    dialogueSnippet,
    faceName: cleanGraphicName(faceGraphic),
    characterName: cleanGraphicName(charGraphic),
  }
}

export function isNpcEvent(ev: MapEventInfo, texts?: Record<string, string>, actorNames?: readonly string[]): boolean {
  if (ev.type === 'transfer' || ev.type === 'chest') return false
  if (isSystemEventName(ev.name) || isSystemEventName(ev.rawName)) return false

  const info = resolveNpcInfo(ev, texts, actorNames)
  const hasCharacterSprite = ev.pages.some((p) => p.characterName && !p.characterName.startsWith('!'))
  const hasSpeaker = Boolean(info.speaker)
  const hasFace = Boolean(info.faceName)
  const isCustomName = !info.isGeneric && !isSystemEventName(info.rawName)

  if (hasSpeaker || hasFace) return true
  if (hasCharacterSprite && (isCustomName || info.dialogueSnippet || ev.type === 'npc')) return true
  if (isCustomName && (hasCharacterSprite || ev.type === 'npc' || /npc|角色|人物|村民|守卫|商人|女仆|侍女|路人|居民|镇民|店主|老板|接待|村长|卫兵|队长/i.test(info.name))) {
    return true
  }
  if (ev.type === 'npc' && (hasCharacterSprite || isCustomName || info.dialogueSnippet)) return true
  return false
}
