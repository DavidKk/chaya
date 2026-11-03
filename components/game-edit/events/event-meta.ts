import type { MapDetailData, MapEventInfo, MapEventType } from '@/lib/game/events'
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

export type ChestResolvedInfo = {
  name: string
  rewardText: string
  rewards: string[]
  isOpened: boolean
}

export function isChestEvent(ev: MapEventInfo): boolean {
  if (ev.type === 'chest') return true
  if (ev.pages.some((p) => /chest|treasure|宝箱|box/i.test(p.characterName))) return true
  const has = (codes: readonly number[]) => ev.pages.some((p) => p.list.some((cmd) => codes.includes(cmd.code)))
  return has([125, 126, 127, 128]) && has([123]) && ev.pages.length <= 4
}

export function resolveChestInfo(
  ev: MapEventInfo,
  names?: { items?: readonly string[]; weapons?: readonly string[]; armors?: readonly string[] },
  detail?: MapDetailData | null
): ChestResolvedInfo {
  const rewards: string[] = []

  for (const page of ev.pages || []) {
    for (const cmd of page.list || []) {
      if (cmd.code === 125) {
        const val = Number(cmd.parameters?.[2]) || 0
        if (val > 0) rewards.push(`${val} 金币`)
      } else if (cmd.code === 126) {
        const id = Number(cmd.parameters?.[0]) || 0
        const val = Number(cmd.parameters?.[3]) || 1
        const itemName = names?.items?.[id] || `物品 #${id}`
        rewards.push(`${itemName} x${val}`)
      } else if (cmd.code === 127) {
        const id = Number(cmd.parameters?.[0]) || 0
        const val = Number(cmd.parameters?.[3]) || 1
        const weaponName = names?.weapons?.[id] || `武器 #${id}`
        rewards.push(`${weaponName} x${val}`)
      } else if (cmd.code === 128) {
        const id = Number(cmd.parameters?.[0]) || 0
        const val = Number(cmd.parameters?.[3]) || 1
        const armorName = names?.armors?.[id] || `防具 #${id}`
        rewards.push(`${armorName} x${val}`)
      }
    }
  }

  let isOpened = false
  if (detail?.live?.onThisMap) {
    const selfSwitches = detail.live.selfSwitches?.[ev.id] || ''
    isOpened = selfSwitches.includes('A')
  } else if (ev.pages.length > 1) {
    const activePage = (detail?.live?.activePage?.[ev.id] ?? 1) - 1
    isOpened = activePage >= 1
  }

  const rawName = (ev.name || ev.rawName || '').trim()
  const customName = !isGenericEventName(rawName) && !isSystemEventName(rawName) ? rawName : ''
  const rewardText = rewards.join('、')
  const name = customName || (rewards.length > 0 ? `${rewards[0]} 宝箱` : `宝箱 #${ev.id}`)

  return {
    name,
    rewardText,
    rewards,
    isOpened,
  }
}

export type TransferResolvedInfo = {
  name: string
  targetMapId: number
  targetMapName: string
  targetCoords?: { x: number; y: number }
}

export function isTransferEvent(ev: MapEventInfo): boolean {
  if (ev.type === 'transfer') return true
  return ev.pages.some((p) => p.list.some((cmd) => cmd.code === 201))
}

export function resolveTransferInfo(ev: MapEventInfo, mapNames?: readonly string[]): TransferResolvedInfo {
  let targetMapId = 0
  let targetCoords: { x: number; y: number } | undefined

  for (const page of ev.pages || []) {
    for (const cmd of page.list || []) {
      if (cmd.code === 201 && Array.isArray(cmd.parameters) && cmd.parameters.length >= 4) {
        const [designationType, tMapId, tX, tY] = cmd.parameters as [number, number, number, number]
        if (designationType === 0 && typeof tMapId === 'number' && tMapId > 0) {
          targetMapId = tMapId
          targetCoords = { x: Number(tX) || 0, y: Number(tY) || 0 }
          break
        }
      }
    }
    if (targetMapId > 0) break
  }

  const targetMapName = targetMapId > 0 ? mapNames?.[targetMapId] || `地图 #${targetMapId}` : ''
  const rawName = (ev.name || ev.rawName || '').trim()
  const customName = !isGenericEventName(rawName) && !isSystemEventName(rawName) ? rawName : ''

  const name = customName ? (targetMapName ? `${customName} → ${targetMapName}` : customName) : targetMapName ? `通往「${targetMapName}」` : `传送点 #${ev.id}`

  return {
    name,
    targetMapId,
    targetMapName,
    targetCoords,
  }
}
