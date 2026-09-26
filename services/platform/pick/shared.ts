export function isCancelError(msg: string): boolean {
  return /User canceled|(-128)/i.test(msg) || /\bcancel(l?ed)\b/i.test(msg) || /exit code [12]\b/i.test(msg)
}

export function normalizeSelected(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\r\n]+/g, '')
    .replace(/[\\/]+$/, '')
}

export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
