/** Set while a recorder field owns keyboard and mouse; plugin hotkeys and assist rules stand down so recorded input only gets recorded. */
const FLAG = '__chayaInputRecording'

/** Dispatched on `window` with `detail: boolean` whenever the flag changes */
export const INPUT_RECORDING_EVENT = 'chaya:input-recording'

type Host = typeof globalThis & { [FLAG]?: boolean }

export function setInputRecording(on: boolean): void {
  ;(globalThis as Host)[FLAG] = on
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INPUT_RECORDING_EVENT, { detail: on }))
}

export function isInputRecording(): boolean {
  return (globalThis as Host)[FLAG] === true
}

/** Turbo / macro output and agent keys are synthetic; only the player's own input counts */
export function isPlayerInput(event: Event): boolean {
  return event.isTrusted
}
