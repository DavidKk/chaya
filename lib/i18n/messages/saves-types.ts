import type { SaveWaitReason } from '@/lib/game/game-saves/types'

/** `saves.*` messages: 辅助 › 游戏存档（页面、迷你面板、游戏内提示与报错） */
export type SavesMessages = {
  page: {
    subtitle: string
    chooseGameTitle: string
    chooseGameDesc: string
    connectTitle: string
    connectDesc: string
    loadFailedTitle: string
    sizeWarning: string
    loadingSaves: string
    loadingSettings: string
    loading: string
    help: string
  }
  auto: {
    title: string
    desc: string
    hint: string
    enable: string
    disable: string
    interval: string
    intervalDesc: string
    minutes: string
    intervalAria: string
    maxCount: string
    maxCountDesc: string
    countUnit: string
    maxCountAria: string
    panel: string
    summary: string
    saveNow: string
    listAria: string
    empty: string
    emptyOn: string
    emptyOff: string
    enabled: string
    disabled: string
  }
  quick: {
    title: string
    desc: string
    hint: string
    enable: string
    disable: string
    panel: string
    hotkeyHint: string
    hotkeyHintExample: string
    exampleSave: string
    exampleLoad: string
    exampleJoin: string
    configureHotkeys: string
    summary: string
    listAria: string
    save: string
    saveSlot: string
    loadSlot: string
    empty: string
    offNote: string
    enabled: string
    disabled: string
  }
  status: {
    off: string
    loading: string
    saving: string
    waiting: string
    paused: string
    inactive: string
    next: string
  }
  wait: Record<SaveWaitReason, string>
  row: {
    unsafe: string
    playtime: string
    load: string
    delete: string
    listSep: string
  }
  tag: { auto: string; manual: string; preload: string; quick: string }
  time: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string }
  mapFallback: string
  mini: {
    title: string
    desc: string
    unavailable: string
    show: string
    turnOn: string
    turnOff: string
    turnedOn: string
    turnedOff: string
  }
  storage: {
    title: string
    desc: string
    game: string
    app: string
    gameHint: string
    appHint: string
    appUnavailable: string
    changedAuto: string
    changedQuick: string
    offlineTitle: string
    offlineDesc: string
  }
  confirm: {
    unsafeDesc: string
    saveAnyway: string
    overwriteTitle: string
    overwriteDesc: string
    overwrite: string
    loadTitle: string
    fromQuick: string
    fromAuto: string
    loadDesc: string
    versionMismatch: string
    load: string
    deleteSlotTitle: string
    deleteTitle: string
    deleteDesc: string
    delete: string
    clearAutoTitle: string
    clearQuickTitle: string
    clearAutoDesc: string
    clearQuickDesc: string
    clear: string
    trimTitle: string
    trimDesc: string
    trimConfirm: string
  }
  error: {
    settingsRead: string
    settingsWrite: string
    revisionConflict: string
    invalidSettings: string
    intervalRange: string
    maxCountRange: string
    connectFirst: string
    timeout: string
    transport: string
    notReadySave: string
    notReadyLoad: string
    invalidContent: string
    staleRoom: string
    invalidSlot: string
    loading: string
    savingSlot: string
    settingsStale: string
    unsafe: string
    quickOff: string
    slotEmpty: string
    missing: string
    versionHotkey: string
    version: string
    loadFailed: string
    noCompression: string
    noDecompression: string
    storageOpen: string
    appOffline: string
    storageWrite: string
    storageQuota: string
    contentMissing: string
    runtimeMissing: string
    assistRuntimeMissing: string
    appRejected: string
  }
  toast: {
    saving: string
    saveFailed: string
    autoSaved: string
    saved: string
    savedSlot: string
    loading: string
    loaded: string
    loadedSlot: string
    loadFailed: string
  }
}
