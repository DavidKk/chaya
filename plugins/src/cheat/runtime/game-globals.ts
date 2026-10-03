/** 非标准或精简的游戏可能没声明部分 $game* 全局；直接写裸标识符会抛 ReferenceError，统一经 globalThis 读取 */
function read(name: string): any {
  return (globalThis as Record<string, unknown>)[name] ?? null
}

export const gamePlayer = () => read('$gamePlayer')
export const gameMap = () => read('$gameMap')
export const gameTroop = () => read('$gameTroop')
export const gameScreen = () => read('$gameScreen')
export const gameMessage = () => read('$gameMessage')
