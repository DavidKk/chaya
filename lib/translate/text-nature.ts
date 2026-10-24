/** Coarse nature groups shared by list filters and shared-cache rows. */
export const TEXT_NATURES = ['dialogue', 'story', 'choice', 'name', 'desc', 'system', 'other'] as const
export type TextNature = (typeof TEXT_NATURES)[number]

const NATURE_CATEGORIES: Record<TextNature, readonly string[]> = {
  dialogue: ['dialogue'],
  story: ['story'],
  choice: ['choice'],
  name: ['item', 'weapon', 'armor', 'skill', 'actor', 'enemy', 'state', 'map'],
  desc: ['item_desc', 'weapon_desc', 'armor_desc', 'skill_desc', 'actor_profile', 'actor_nickname'],
  system: ['system', 'state_msg', 'plugin', 'resource'],
  other: ['other'],
}

const CATEGORY_TO_NATURE = new Map<string, TextNature>()
for (const [nature, cats] of Object.entries(NATURE_CATEGORIES) as Array<[TextNature, readonly string[]]>) {
  for (const cat of cats) CATEGORY_TO_NATURE.set(cat, nature)
}

export function parseTextNature(raw: string | null | undefined): TextNature | '' {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  return (TEXT_NATURES as readonly string[]).includes(value) ? (value as TextNature) : ''
}

export function categoriesForNature(nature: TextNature): readonly string[] {
  return NATURE_CATEGORIES[nature]
}

export function natureOfCategory(category?: string | null): TextNature | '' {
  if (!category) return ''
  return CATEGORY_TO_NATURE.get(category) || ''
}

/** Normalize extract/live category tags for storage; empty means unset. */
export function normalizeCacheCategory(raw?: string | null): string {
  const value = String(raw || '').trim()
  return value
}
