export function confirmWindowIndex(window: any, index: number): boolean {
  if (!window?.active || index < 0 || typeof window.select !== 'function' || typeof window.processOk !== 'function') return false
  window.select(index)
  if (window.isCurrentItemEnabled?.() === false) return false
  window.processOk()
  return true
}

export function confirmWindowCommand(window: any, symbol: string, ext?: number): boolean {
  const index = window?._list?.findIndex((command: any) => command.symbol === symbol && (ext === undefined || command.ext === ext)) ?? -1
  return confirmWindowIndex(window, index)
}

export function isHpRecovery(item: any): boolean {
  return Boolean(
    item && [7, 8, 11].includes(item.scope) && (item.damage?.type === 3 || item.effects?.some((effect: any) => effect?.code === 11 && (effect.value1 > 0 || effect.value2 > 0)))
  )
}

export function hpRatio(actor: any): number {
  return (actor?.hp ?? 0) / Math.max(actor?.mhp ?? 1, 1)
}
