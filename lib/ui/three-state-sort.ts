/** 表头三态排序：升序 → 降序 → 还原默认（无 I/O） */

export type ThreeStateSortDir = 'asc' | 'desc'

export type ThreeStateSortState<K extends string> = {
  key: K
  order: ThreeStateSortDir
  /** false = 还原态（用默认 key/order 查数，表头不点亮） */
  explicit: boolean
}

export function cycleThreeStateSort<K extends string>(clicked: K, state: ThreeStateSortState<K>, defaults: { key: K; order: ThreeStateSortDir }): ThreeStateSortState<K> {
  if (!state.explicit || state.key !== clicked) {
    return { key: clicked, order: 'asc', explicit: true }
  }
  if (state.order === 'asc') {
    return { key: clicked, order: 'desc', explicit: true }
  }
  return { key: defaults.key, order: defaults.order, explicit: false }
}
