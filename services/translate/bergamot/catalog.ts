import { bergamotLanguage, type BergamotPack } from '@/lib/translate/bergamot'

import models from './models.json'

export const bergamotPacks: BergamotPack[] = models
export function findPack(source: string, target: string) {
  return bergamotPacks.find(
    (pack) => pack.source === bergamotLanguage(source) && pack.target === bergamotLanguage(target) && pack.platforms.includes(`${process.platform}-${process.arch}`)
  )
}

export function bergamotPlatformSupported() {
  return bergamotPacks.some((pack) => pack.platforms.includes(`${process.platform}-${process.arch}`))
}
