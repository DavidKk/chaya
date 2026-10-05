export { getResolvedFromConfig } from './binding'
export { CONFIG_FILE, loadConfig, saveConfig } from './config'
export { formatBytes, measureDirSizeBytes } from './disk-size'
export { launchShellWithContent, openInFinder, revealInFinder } from './finder'
export { collectGameFingerprint, getGameFingerprint, getGameFingerprintSummary } from './fingerprint'
export {
  displayNameFromPath,
  findLibraryEntry,
  isLibraryEntryId,
  libraryDisplayName,
  libraryEntryId,
  normalizeLibrary,
  normalizeRemark,
  pathEquals,
  reconcileLibraryConfig,
  removeLibraryEntry,
  sameGameFamily,
  toLibraryItemView,
  touchLibraryOpen,
  upsertLibraryEntry,
} from './library'
export { type EnsureLatestNwOpts, ensureLatestNwShellSource, findShellSourceInExtract, type NwDownloadResult } from './nw-download'
export { DEFAULT_WINDOW, ensureNwPackageName, normalizeWindow, type NwPackageInfo, type NwWindowConfig, readNwPackage, writeNwWindow } from './nw-package'
export { type PickKind, pickPath, type PickResult } from './picker'
export { type PluginHotChange, subscribePluginHot } from './plugin-hot-bus'
export {
  type ClearPluginsResult,
  clearTrackedPlugins,
  detectPlugins,
  detectPluginsOutdated,
  type InjectPluginsResult,
  injectTrackedPlugins,
  kitPluginDigests,
  loadPluginManifest,
  readTranslateSwitches,
  resolveKitPluginSource,
} from './plugins'
export {
  ensureShellLinkedToContent,
  installShell,
  isShellInstalling,
  isToolkitShellInstalled,
  recoverOldIfNeeded,
  shellInstallHint,
  type ShellInstallResult,
  ShellSwapError,
  type UninstallShellResult,
  uninstallToolkitShell,
  validateShellSource,
} from './shell'

/** 从 lib 再导出常用抽象，方便 API 一处引入 */
export {
  type ChayaConfig,
  type LibraryEntry,
  type LibraryItemView,
  type LibrarySortMode,
  type PluginManifestEntry,
  type PluginStatus,
  type ResolvedGame,
  type ResolveError,
  resolveGame,
  SHELL_APP_NAME,
  TRACKED_PLUGINS,
  type TrackedPlugin,
} from '@/lib/game'
