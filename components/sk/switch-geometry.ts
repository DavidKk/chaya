/**
 * Switch 轨道 / 滑块几何真源。
 * 改大小只改这里；样式与 e2e 共用，保证四边 inset 始终相等。
 *
 * 关系：thumb = trackH - 2*border - 2*inset
 * travel = trackW - 2*border - 2*inset - thumb
 */
export const SWITCH_TRACK_H = 24
export const SWITCH_TRACK_W = 44
export const SWITCH_BORDER = 1
/** 滑块与轨道内缘的统一边距（上/下/左关/右开） */
export const SWITCH_INSET = 3

export const SWITCH_THUMB = SWITCH_TRACK_H - 2 * SWITCH_BORDER - 2 * SWITCH_INSET
export const SWITCH_TRAVEL = SWITCH_TRACK_W - 2 * SWITCH_BORDER - 2 * SWITCH_INSET - SWITCH_THUMB

/** Tailwind 类：与上面常数对齐（h-6=24 / w-11=44 / p-[3px] / size 由 h-full 推导） */
export const switchTrackClass = 'h-6 w-11 border p-[3px]'
export const switchThumbClass = 'aspect-square h-full'
