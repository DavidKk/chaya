/**
 * DiskOps 能力门面：Route 只从这里取本机盘能力（local/app 共用实现）。
 * 入口须先 `requireDisk()`；vercel 不得平行实现一套 DiskOps。
 *
 * 实现仍在 services/game、translate、extract、log 等域模块，本目录不复制业务。
 */
export { canUseDisk, diskUnavailable, requireDisk } from '@/lib/service-mode'
export { extractAndEnsureSeed } from '@/services/extract/ensure-seed'
export {
  type ClearPluginsResult,
  clearTrackedPlugins,
  detectPlugins,
  displayNameFromPath,
  ensureNwPackageName,
  ensureShellLinkedToContent,
  findLibraryEntry,
  formatBytes,
  getGameFingerprint,
  getResolvedFromConfig,
  type InjectPluginsResult,
  injectTrackedPlugins,
  installShell,
  isToolkitShellInstalled,
  launchShellWithContent,
  loadConfig,
  measureDirSizeBytes,
  type NwPackageInfo,
  type NwWindowConfig,
  openInFinder,
  pathEquals,
  type PickKind,
  pickPath,
  type PickResult,
  readNwPackage,
  readTranslateSwitches,
  reconcileLibraryConfig,
  removeLibraryEntry,
  resolveGame,
  revealInFinder,
  saveConfig,
  type ShellInstallResult,
  toLibraryItemView,
  TRACKED_PLUGINS,
  type UninstallShellResult,
  uninstallToolkitShell,
  upsertLibraryEntry,
  writeNwWindow,
} from '@/services/game'
export { loadGameEditCatalog } from '@/services/game/game-edit-catalog'
export { ensureLatestNwShellSource, type NwDownloadResult } from '@/services/game/nw-download'
export { appendLog, clearLogs, listLogs, logBusStats, type LogLevel } from '@/services/log'
export { deleteSharedTranslateCache, importSharedTranslateCache, parseTranslateImportText, querySharedTranslateCache, updateSharedTranslateCache } from '@/services/translate'
export { getTranslateEngineSwitches, setTranslateEngineSwitches, type TranslateEngineId, type TranslateEngineSwitches } from '@/services/translate/engine-switches'
export { fillMissingFromSeed } from '@/services/translate/fill-missing'
export { liveTranslateTexts } from '@/services/translate/live-translate'
export { getSeedJobSnapshot, pauseSeedJob, startSeedJob } from '@/services/translate/seed-job'
