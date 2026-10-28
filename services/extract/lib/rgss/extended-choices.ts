export type ExtendedChoice = { text: string; start: number; end: number }

const CONTROLS = /\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[^A-Za-z\r\n])/g

function literal(text: string) {
  return !/[,[\]\r\n]/.test(text.replace(CONTROLS, '')) && !/@m\(|<s>/i.test(text)
}

function fields(raw: string, start: number, end: number): ExtendedChoice[] | null {
  const result: ExtendedChoice[] = []
  let depth = 0
  let from = start
  const push = (to: number) => {
    const value = raw.slice(from, to)
    const text = value.trim()
    const offset = value.length - value.trimStart().length
    result.push({ text, start: from + offset, end: from + offset + text.length })
  }
  for (let i = start; i < end; i++) {
    if (raw[i] === '[') depth++
    else if (raw[i] === ']' && --depth < 0) return null
    else if (raw[i] === ',' && depth === 0) {
      push(i)
      from = i + 1
    }
  }
  if (depth !== 0) return null
  push(end)
  return result
}

/** A1_ExChoice concatenates 108/408 comments without separators before splitting its arguments. */
export function parseRgssExtendedChoices(raw: string): ExtendedChoice[] | null {
  if (raw.length > 100_000) return null
  const header = /^拡張選択肢[ \t]+/.exec(raw)
  if (!header) return null
  const args = fields(raw, header[0].length, raw.length)
  if (!args || args.length < 3 || !/^-?\d+$/.test(args[0]!.text) || !/^\d*$/.test(args[1]!.text)) return null
  const third = args[2]!
  let choices: ExtendedChoice[] | null
  if (third.text.startsWith('[')) {
    if (!third.text.endsWith(']') || args.length > 5) return null
    if (args.slice(3).some((arg) => !/^(?:-?\d+|左|中|右|上|下)?$/.test(arg.text))) return null
    choices = fields(raw, third.start + 1, third.end - 1)
  } else choices = args.slice(2)
  // Dynamic Ruby expressions and nested arrays need a separate adapter; never translate executable arguments.
  return choices && choices.every((choice) => literal(choice.text)) ? choices : null
}

export function assertExtendedChoiceTranslation(source: string, target: string) {
  if (!literal(target) || JSON.stringify(source.match(CONTROLS) || []) !== JSON.stringify(target.match(CONTROLS) || [])) {
    throw new Error('Extended choice translation must preserve escape controls and cannot contain commas, brackets or executable expressions')
  }
}
