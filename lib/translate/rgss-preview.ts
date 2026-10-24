/** In-game view: runtime lookup on (translated) vs off (original). Config only — no Data write. */
export type RgssPreviewView = 'original' | 'translated'

export type RgssPreviewSettings = {
  view: RgssPreviewView
}

export const DEFAULT_RGSS_PREVIEW: RgssPreviewSettings = { view: 'translated' }

export function normalizeRgssPreview(raw: unknown): RgssPreviewSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<RgssPreviewSettings>) : {}
  return { view: value.view === 'original' ? 'original' : 'translated' }
}
