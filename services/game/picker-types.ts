/** 选择器共用类型（供 platform/pick 与 game 门面共用，避免循环依赖） */
export type PickKind = 'folder' | 'app' | 'game'

export type PickResult = { ok: true; path: string } | { ok: false; cancelled: true } | { ok: false; error: string }
