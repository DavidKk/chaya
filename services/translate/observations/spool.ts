import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import type { TranslationObservation } from '@/lib/translate/observation'

export const observationSpoolDirectory = () => path.join(DATA_DIR, 'translation-observations', 'pending')

/** Persist before returning a failed item; no classification/daemon wait on the translation lane. */
export function spoolTranslationObservations(events: TranslationObservation[], directory = observationSpoolDirectory()) {
  if (!events.length) return
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.jsonl`)
  const partial = `${file}.partial`
  const fd = fs.openSync(partial, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, events.map((event) => JSON.stringify(event)).join('\n') + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(partial, file)
}
