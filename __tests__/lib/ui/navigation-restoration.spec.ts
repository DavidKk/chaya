/** @jest-environment jsdom */
import { commitNavigationRestoration, registerScrollRestoration, returnToNavigationSource } from '@/lib/ui/navigation-restoration'
import { localNavigationHref, readScrollSnapshot } from '@/lib/ui/navigation-snapshot'
import { restoreScrollRoot, snapshotScrollRoot } from '@/lib/ui/restore-scroll-root'

const nativeReplace = history.replaceState.bind(history)
let cleanups: (() => void)[]
let animate: jest.Mock
let resizeCallbacks: (() => void)[]

function viewport() {
  const root = document.createElement('div')
  Object.defineProperties(root, {
    clientHeight: { value: 300, configurable: true },
    clientWidth: { value: 500 },
    scrollHeight: { value: 3000 },
  })
  root.getBoundingClientRect = () => ({ top: 20 }) as DOMRect
  for (let i = 0; i < 100; i++) {
    const row = document.createElement('button')
    row.dataset.navigationId = `item:${i}`
    row.dataset.navigationTrigger = ''
    row.textContent = `项目 ${i}`
    row.getBoundingClientRect = () => ({ top: 20 + i * 30 - root.scrollTop }) as DOMRect
    root.append(row)
  }
  document.body.append(root)
  return root
}

beforeEach(() => {
  jest.useFakeTimers()
  cleanups = []
  resizeCallbacks = []
  animate = jest.fn(() => ({ cancel: jest.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  Object.assign(globalThis, {
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    },
    matchMedia: jest.fn(() => ({ matches: false })),
  })
  history.replaceState({}, '', `/list?size=100&case=${Math.random()}`)
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  document.body.replaceChildren()
  jest.useRealTimers()
})

test('100 条页底进入详情，返回同一历史条目并恢复双轴位置、原项目和焦点，只闪两轮', () => {
  const source = viewport()
  const release = registerScrollRestoration(source, 'items')
  source.scrollTop = 2700
  source.scrollLeft = 45
  const item = source.children[97] as HTMLElement
  item.focus()
  item.click()
  const state = history.state
  const href = location.href
  const snapshotKey = `${state.__chayaNavigation.id}:${state.__chayaNavigation.href}:items`
  history.pushState({}, '', '/detail/97')
  release()
  source.remove()
  const router = { back: jest.fn(), push: jest.fn() }
  returnToNavigationSource(router, '/list')
  expect(router.back).toHaveBeenCalledTimes(1)
  nativeReplace(state, '', href)
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
  commitNavigationRestoration()
  const restored = viewport()
  const stop = registerScrollRestoration(restored, 'items')
  jest.advanceTimersByTime(30)
  expect(restored.scrollTop).toBe(2700)
  expect(restored.scrollLeft).toBe(45)
  expect(document.activeElement).toBe(restored.children[97])
  expect(animate).toHaveBeenCalledTimes(1)
  expect(animate.mock.calls[0][0].map((frame: Keyframe) => frame.offset)).toEqual([0, 0.2, 0.5, 0.7, 1])
  expect(animate.mock.calls[0][1]).toMatchObject({ duration: 1200, iterations: 1 })
  expect(readScrollSnapshot(snapshotKey)?.pending).toBe(false)
  stop()
  restored.remove()
  const remounted = viewport()
  cleanups.push(registerScrollRestoration(remounted, 'items'))
  jest.advanceTimersByTime(30)
  expect(animate).toHaveBeenCalledTimes(1)
})

test('内部子视图卸载再返回也恢复位置和项目，查询作用域互不覆盖', () => {
  const root = viewport()
  const release = registerScrollRestoration(root, 'local:query=A')
  root.scrollTop = 2100
  ;(root.children[75] as HTMLElement).click()
  release()
  root.remove()
  const other = viewport()
  const releaseOther = registerScrollRestoration(other, 'local:query=B')
  jest.advanceTimersByTime(30)
  expect(other.scrollTop).toBe(0)
  releaseOther()
  other.remove()
  const returned = viewport()
  cleanups.push(registerScrollRestoration(returned, 'local:query=A'))
  jest.advanceTimersByTime(30)
  expect(returned.scrollTop).toBe(2100)
  expect(animate).toHaveBeenCalledTimes(1)
})

test('隐藏的 GameEdit 来源不会被子视图返回按钮清除锚点', () => {
  const root = viewport()
  cleanups.push(registerScrollRestoration(root, 'hidden-source'))
  root.scrollTop = 2100
  ;(root.children[75] as HTMLElement).click()
  Object.defineProperty(root, 'clientHeight', { value: 0, configurable: true })
  for (const callback of [...resizeCallbacks]) callback()
  const back = document.createElement('button')
  document.body.append(back)
  back.click()
  Object.defineProperty(root, 'clientHeight', { value: 300, configurable: true })
  root.scrollTop = 0
  for (const callback of [...resizeCallbacks]) callback()
  jest.advanceTimersByTime(30)
  expect(root.scrollTop).toBe(2100)
  expect(document.activeElement).toBe(root.children[75])
  expect(animate).toHaveBeenCalledTimes(1)
})

test('原项目删除时降级到邻居，不闪烁替代项目', () => {
  const root = viewport()
  root.scrollTop = 2400
  const saved = snapshotScrollRoot(root, undefined, root.children[85] as HTMLElement)
  root.children[85].remove()
  root.scrollTop = 0
  cleanups.push(restoreScrollRoot(root, { ...saved, pending: true }, 'deleted'))
  jest.advanceTimersByTime(1000)
  expect(root.scrollTop).toBe(2430)
  expect(animate).not.toHaveBeenCalled()
})

test('慢加载时主动滚动取消恢复，后续数据到达不再拉回', () => {
  const root = viewport()
  const saved = { ...snapshotScrollRoot(root), y: 2700, anchor: 'late', pending: true }
  cleanups.push(restoreScrollRoot(root, saved, 'interrupted'))
  root.dispatchEvent(new Event('wheel'))
  root.scrollTop = 600
  const row = document.createElement('button')
  row.dataset.navigationId = 'late'
  root.append(row)
  jest.advanceTimersByTime(9000)
  expect(root.scrollTop).toBe(600)
  expect(animate).not.toHaveBeenCalled()
  expect(readScrollSnapshot('interrupted')?.pending).toBe(false)
})

test('加载中的旧行不会提前完成恢复，数据就绪后才定位和闪烁', async () => {
  const root = viewport()
  const saved = { ...snapshotScrollRoot(root, undefined, root.children[97] as HTMLElement), y: 2700, offset: 210, pending: true }
  root.setAttribute('aria-busy', 'true')
  cleanups.push(restoreScrollRoot(root, saved, 'loading'))
  await jest.advanceTimersByTimeAsync(1500)
  expect(root.scrollTop).toBe(0)
  expect(animate).not.toHaveBeenCalled()
  root.removeAttribute('aria-busy')
  await jest.advanceTimersByTimeAsync(30)
  expect(root.scrollTop).toBe(2700)
  expect(animate).toHaveBeenCalledTimes(1)
})

test('编辑或勾选行内控件不会被当成进入详情，重挂载不误闪', () => {
  const root = viewport()
  const release = registerScrollRestoration(root, 'editing')
  root.scrollTop = 2100
  const button = root.children[75] as HTMLElement
  delete button.dataset.navigationTrigger
  button.click()
  release()
  root.remove()
  const returned = viewport()
  cleanups.push(registerScrollRestoration(returned, 'editing'))
  jest.advanceTimersByTime(30)
  expect(returned.scrollTop).toBe(2100)
  expect(animate).not.toHaveBeenCalled()
})

test('减少动态效果使用静态高亮；普通刷新只恢复滚动', () => {
  const root = viewport()
  const saved = snapshotScrollRoot(root, undefined, root.children[97] as HTMLElement)
  Object.assign(window, { matchMedia: jest.fn(() => ({ matches: true })) })
  cleanups.push(restoreScrollRoot(root, { ...saved, pending: true }, 'reduced'))
  jest.advanceTimersByTime(30)
  expect(animate.mock.calls[0][0]).toHaveLength(2)
  expect(animate.mock.calls[0][0][0]).toEqual(animate.mock.calls[0][0][1])
  animate.mockClear()
  cleanups.push(restoreScrollRoot(root, { ...saved, pending: false }, 'reload'))
  jest.advanceTimersByTime(30)
  expect(animate).not.toHaveBeenCalled()
})

test('虚拟列表先恢复可见范围，再定位延迟挂载的稳定 ID', () => {
  const root = viewport()
  root.replaceChildren()
  const saved = { x: 0, y: 2700, height: 3000, anchor: 'item:97', offset: 210, pending: true }
  cleanups.push(restoreScrollRoot(root, saved, 'virtual', (id) => (id === 'item:97' ? 2910 : undefined)))
  jest.advanceTimersByTime(30)
  expect(root.scrollTop).toBe(2700)
  expect(animate).not.toHaveBeenCalled()
  const row = document.createElement('button')
  row.dataset.navigationId = 'item:97'
  row.getBoundingClientRect = () => ({ top: 20 + 2910 - root.scrollTop }) as DOMRect
  root.append(row)
  jest.advanceTimersByTime(1000)
  expect(root.scrollTop).toBe(2700)
  expect(document.activeElement).toBe(row)
  expect(animate).toHaveBeenCalledTimes(1)
})

test('相同 URL 的不同历史条目独立保存，返回已挂载滚动根也可恢复', () => {
  const source = viewport()
  cleanups.push(registerScrollRestoration(source, 'same-url'))
  source.scrollTop = 1800
  source.dispatchEvent(new Event('scroll'))
  const first = history.state
  history.pushState({}, '', location.href)
  expect(history.state.__chayaNavigation.id).not.toBe(first.__chayaNavigation.id)
  commitNavigationRestoration()
  source.scrollTop = 600
  source.dispatchEvent(new Event('scroll'))
  nativeReplace(first, '', location.href)
  window.dispatchEvent(new PopStateEvent('popstate', { state: first }))
  commitNavigationRestoration()
  jest.advanceTimersByTime(30)
  expect(source.scrollTop).toBe(1800)
  expect(animate).not.toHaveBeenCalled()
})

test('直接访问子页使用本地兜底，拒绝外部返回地址', () => {
  history.replaceState({}, '', '/direct-detail')
  const router = { back: jest.fn(), push: jest.fn() }
  returnToNavigationSource(router, 'https://outside.example/list')
  expect(router.push).toHaveBeenCalledWith('/')
  expect(router.back).not.toHaveBeenCalled()
  expect(localNavigationHref('/translate/cache?page=3')).toBe('/translate/cache?page=3')
  expect(localNavigationHref('//outside.example/')).toBeNull()
})
