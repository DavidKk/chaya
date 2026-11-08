export type StoryTransfer = {
  mapId: number | null
  path: Array<{ commands: any[]; index: number }>
  choices: Array<{ commands: any[]; commandIndex: number; labels: string[]; index: number }>
}

export function storyTransfers(event: any, commands?: any[]): StoryTransfer[] {
  if (!commands) {
    if (!event || event._erased || event._pageIndex < 0 || (typeof event.page === 'function' && !event.page())) return []
    commands = event.list?.() ?? []
  }
  const engine = globalThis as any
  const transfers: StoryTransfer[] = []
  const visiting = new Set<number>()
  const scan = (list: any[], inherited: StoryTransfer['choices'], path: StoryTransfer['path'], depth: number) => {
    if (depth > 20) return
    const branches = new Map<number, StoryTransfer['choices'][number]>()
    for (const [commandIndex, command] of list.entries()) {
      const parameters = command?.parameters ?? []
      const indent = command?.indent ?? 0
      if (command?.code === 102) branches.set(indent, { commands: list, commandIndex, labels: parameters[0] ?? [], index: -1 })
      if (command?.code === 402) {
        const branch = branches.get(indent)
        if (branch) branch.index = parameters[0]
      }
      if (command?.code === 403) {
        const branch = branches.get(indent)
        if (branch) branch.index = -2
      }
      if (command?.code === 404) branches.delete(indent)
      const choices = [...inherited, ...branches.values()].map((branch) => ({ ...branch }))
      if (command?.code === 201) {
        const destination = parameters[0] === 0 ? parameters[1] : engine.$gameVariables?.value?.(parameters[1])
        transfers.push({ mapId: Number.isInteger(destination) && destination > 0 ? destination : null, path: [...path, { commands: list, index: commandIndex }], choices })
      }
      if (command?.code === 117 && !visiting.has(parameters[0])) {
        visiting.add(parameters[0])
        scan(engine.$dataCommonEvents?.[parameters[0]]?.list ?? [], choices, [...path, { commands: list, index: commandIndex }], depth + 1)
        visiting.delete(parameters[0])
      }
    }
  }
  scan(commands ?? [], [], [], 0)
  return transfers
}

export function isCrossMapTransfer(transfer: StoryTransfer, mapId: number): boolean {
  return transfer.mapId !== null && transfer.mapId !== mapId
}

export function isStoryMapExit(event: any, mapId: number): boolean {
  return storyTransfers(event).some((transfer) => isCrossMapTransfer(transfer, mapId))
}

export function storyTravelDirection(text: string): 'up' | 'down' | null {
  if (/不上|不下|不要|别|留在|stay|don't|do not|не\s/i.test(text)) return null
  if (/上(?:上|一)?(?:层|樓|楼)|往上|upstairs|stairs\s*up|go\s*up|наверх|подняться/i.test(text)) return 'up'
  if (/下(?:一)?(?:层|樓|楼)|往下|downstairs|stairs\s*down|go\s*down|вниз|спуститься/i.test(text)) return 'down'
  return null
}
