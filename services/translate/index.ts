export {
  deleteSharedTranslateCache,
  type DeleteSharedTranslateResult,
  getSharedTranslateCacheById,
  getSharedTranslateCacheStats,
  importSharedTranslateCache,
  type ImportSharedTranslateResult,
  querySharedTranslateCache,
  setSharedTranslateCacheNsfw,
  type TranslateCacheItem,
  type TranslateCachePage,
  updateSharedTranslateCache,
  type UpdateSharedTranslateResult,
  upsertSharedTranslateCachePairs,
  type UpsertSharedTranslatePairsResult,
} from './cache-api'
export {
  DEFAULT_ENGINE_ORDER,
  DEFAULT_ENGINE_SWITCHES,
  type EngineSwitchesState,
  getTranslateEngineSwitches,
  normalizeEngineOrder,
  type SetEngineSwitchesInput,
  setTranslateEngineSwitches,
  TRANSLATE_ENGINE_IDS,
  TRANSLATE_ENGINE_META,
  type TranslateEngineId,
  type TranslateEngineSwitches,
} from './engine-switches'
export { fillMissingFromSeed, type FillMissingResult, getSeedTranslateProgress, type SeedProgress } from './fill-missing'
export { loadGameTranslateLookup, normalizeTranslateKey, translateWithLookup } from './game-lookup'
export { exportSourcesPayload, type NormalizedSources, normalizeSourcesInput, type SourcesEntry, type SourcesInputFormat } from './import-sources'
export { parseTranslateImportText } from './import-text'
export { assertOptimizeMayDispatch, recordLiveTranslateActivity } from './live-activity'
export { googleJaToZh, type LiveTranslateItem, liveTranslateTexts } from './live-translate'
export {
  applyGameTermFixes,
  type ApplyTermFixesResult,
  type BatchOptimizeOptions,
  type BatchOptimizeResult,
  batchOptimizeTranslations,
  isAlreadyOptimizedEngine,
  isMachineTranslationEngine,
  isShortEntityItem,
  isSystemIdleForOptimization,
  OPTIMIZE_ENGINE_AGENT,
  OPTIMIZE_ENGINE_TERMS,
  runShortEntityOptimization,
  scanGameTranslationsForOptimization,
  type ScanOptimizationResult,
  type ShortEntityOptimizeOptions,
  type ShortEntityOptimizeResult,
  type TermFixCandidate,
  trackLiveTranslateRequest,
} from './optimize-service'
export { getSeedJobSnapshot, pauseSeedJob, type SeedJobLogEntry, type SeedJobSnapshot, type SeedJobState, type SeedJobStatus, startSeedJob } from './seed-job'
export { inspectSensitiveText, isNsfwCacheRow, isNsfwTaggedEngine, isSensitiveForCloud, partitionCloudSafeTexts, type SensitiveHit } from './sensitive-text'
export { defaultSharedDbPath, openSharedCache } from './shared-cache'
export {
  exportSourcesJob,
  getSourcesJobStatus,
  importSourcesJob,
  searchSourcesJob,
  type SourcesExportResult,
  type SourcesJobSnapshot,
  type SourcesJobStatus,
  type SourcesSearchResult,
} from './sources-job'
export {
  charCount,
  isIdenticalTranslation,
  isStorableTranslation,
  isUsefulTranslation,
  lineCount,
  peelControlShell,
  peelProtectShell,
  protectControlCodes,
  protectForTranslate,
  restoreControlCodes,
  restoreForTranslate,
  shouldTranslate,
  stripControlNoise,
  translationCoreForCache,
} from './text-classify'
export type { SharedCacheSortDir, SharedCacheSortKey } from '@/lib/translate/cache-query'
export { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'
