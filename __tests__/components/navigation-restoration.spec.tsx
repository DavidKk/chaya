/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { NavigationScope } from '@/components/navigation/NavigationScope'
import { useNavigationBooleanState, useNavigationViewState } from '@/components/navigation/useNavigationViewState'

const nativeReplace = history.replaceState.bind(history)
let root: Root
let host: HTMLDivElement

function View({ name }: { name: string }) {
  const [value, setValue] = useNavigationViewState<string>(name, '')
  const [enabled, setEnabled] = useNavigationBooleanState(`enabled:${name}`, true)
  return (
    <>
      <output>{value}</output>
      <button onClick={() => setValue('原文搜索')}>搜索</button>
      <span data-enabled>{String(enabled)}</span>
      <button data-toggle onClick={() => setEnabled((previous) => !previous)}>
        切换
      </button>
    </>
  )
}
async function render(name: string, game = 'game-a') {
  await act(async () =>
    root.render(
      <NavigationScope value={game}>
        <View name={name} />
      </NavigationScope>
    )
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  history.replaceState({}, '', `/data?test=${Math.random()}`)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('子视图返回恢复来源搜索条件，不串到其它游戏', async () => {
  await render('root')
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('output')?.textContent).toBe('原文搜索')
  const source = history.state
  const href = location.href
  history.pushState({}, '', '/data/child')
  await render('child')
  expect(host.querySelector('output')?.textContent).toBe('')
  nativeReplace(source, '', href)
  window.dispatchEvent(new PopStateEvent('popstate', { state: source }))
  await render('root')
  expect(host.querySelector('output')?.textContent).toBe('原文搜索')
  await render('root', 'game-b')
  expect(host.querySelector('output')?.textContent).toBe('')
  await render('root', 'game-a')
  expect(host.querySelector('output')?.textContent).toBe('原文搜索')
})

test('replace 查询保留本地筛选，同类子视图继承筛选且返回恢复来源值', async () => {
  await render('filters')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-toggle]')!.click())
  const identity = history.state.__chayaNavigation.id
  history.replaceState({}, '', '/data?q=changed')
  await render('filters')
  expect(history.state.__chayaNavigation.id).toBe(identity)
  expect(host.querySelector('[data-enabled]')?.textContent).toBe('false')
  const source = history.state
  const href = location.href
  history.pushState({}, '', '/data/child')
  await render('filters')
  expect(host.querySelector('[data-enabled]')?.textContent).toBe('false')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-toggle]')!.click())
  expect(host.querySelector('[data-enabled]')?.textContent).toBe('true')
  nativeReplace(source, '', href)
  window.dispatchEvent(new PopStateEvent('popstate', { state: source }))
  await render('filters')
  expect(host.querySelector('[data-enabled]')?.textContent).toBe('false')
})
