export type SilentTranslateConfig = {
  enabled: boolean
  engine: string
}

export const DEFAULT_SILENT_TRANSLATE_CONFIG: SilentTranslateConfig = {
  enabled: false,
  engine: 'default',
}
