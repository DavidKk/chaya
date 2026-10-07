/** Set while a recorder field owns keyboard and mouse; plugin hotkeys and assist rules stand down so recorded input only gets recorded. */
const FLAG = '__chayaInputRecording'

type Host = typeof globalThis & { [FLAG]?: boolean }

export function setInputRecording(on: boolean): void {
  ;(globalThis as Host)[FLAG] = on
}

export function isInputRecording(): boolean {
  return (globalThis as Host)[FLAG] === true
}
