/** Visible-text MV plugin commands. Extract explicit text arguments while preserving command names, image names and script arguments. */
export function mvPluginText(command: string): { kind: 'message' | 'choices'; texts: string[] } | null {
  const match = /^LL_GalgeChoiceWindowMV\s+(setMessageText|setChoices)(?:\s+(\S+))?/.exec(command)
  if (!match) return null
  const value = match[2] || ''
  return match[1] === 'setChoices' ? { kind: 'choices', texts: value.split(',') } : { kind: 'message', texts: value ? [value] : [] }
}
