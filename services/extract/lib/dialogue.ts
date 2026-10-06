import { extractPluginText } from './plugin-text'
import { clean, isUseful } from './text'

function paramsOf(cmd: { parameters?: unknown[]; params?: unknown[] }) {
  return cmd.parameters || cmd.params || []
}

function walkEventList(list: unknown[] | undefined, onCommand: (cmd: any, index: number) => void) {
  ;(list || []).forEach((cmd, index) => {
    if (!cmd) return
    onCommand(cmd, index)
  })
}

export type DialogueLoc = Record<string, unknown>

export function extractDialogueFromEvents(events: any[] | undefined, loc: DialogueLoc) {
  const ordered: any[] = []

  ;(events || []).forEach((ev, eventIndex) => {
    if (!ev) return
    const eventId = ev.id != null ? ev.id : eventIndex
    const eventName = clean(ev.name) || undefined
    const pages = ev.pages || [{ list: ev.list }]

    pages.forEach((page: any) => {
      let block: any = null
      let choiceHelp = false

      const flush = () => {
        if (!block || !block.lines.length) {
          block = null
          return
        }
        ordered.push(block)
        block = null
      }

      const base = () => {
        const row: any = { ...loc, kind: 'd' }
        if (eventName) row.ev = eventName
        row.eid = eventId
        return row
      }

      walkEventList(page.list, (cmd) => {
        const p = paramsOf(cmd) as any[]

        // MPP_ChoiceEX 将可见的选项说明放在指定注释块中；普通注释不是游戏文案。
        if (cmd.code === 108) {
          flush()
          choiceHelp = /^(?:ChoiceHelp|<ChoiceHelp>|選択肢ヘルプ|<選択肢ヘルプ>)$/.test(String(p[0] || '').trim())
          return
        }
        if (cmd.code === 408 && choiceHelp) {
          const line = clean(p[0])
          if (isUseful(line)) {
            if (!block) block = { ...base(), lines: [] }
            block.lines.push(line)
          }
          return
        }
        if (choiceHelp) flush()
        choiceHelp = false

        if (cmd.code === 101) {
          flush()
          block = { ...base(), lines: [] }
          const face = p[0] || ''
          if (face) block.face = face
          return
        }

        if (cmd.code === 401) {
          const line = clean(p[0])
          if (!line) return
          if (!block) block = { ...base(), lines: [] }
          block.lines.push(line)
          return
        }

        if (cmd.code === 405) {
          flush()
          const line = clean(p[0])
          if (!isUseful(line)) return
          ordered.push({ ...base(), kind: 's', lines: [line] })
          return
        }

        if (cmd.code === 102) {
          flush()
          const choices = (p[0] || []).map(clean).filter(isUseful)
          if (!choices.length) return
          const row = { ...base(), kind: 'c', choices }
          delete row.face
          ordered.push(row)
          return
        }

        if (cmd.code === 357) {
          flush()
          const lines = extractPluginText(p[3])
          if (lines.length) ordered.push({ ...base(), kind: 'p', lines })
          return
        }

        if (cmd.code !== 401 && cmd.code !== 101) flush()
      })

      flush()
    })
  })

  return ordered
}
