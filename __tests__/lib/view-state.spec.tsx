/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { readViewState, useViewState, writeViewState } from '@/lib/view-state'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const isId = (v: unknown): v is string | undefined => v === undefined || typeof v === 'string'

function Probe({ onReady }: { onReady: (set: (v: string | undefined) => void) => void }) {
  const [id, setId] = useViewState<string | undefined>('test.id', undefined, isId)
  onReady(setId)
  return <span>{id ?? 'list'}</span>
}

test('keeps the detail across a remount (page refresh) and clears it on return to the list', async () => {
  let set: (v: string | undefined) => void = () => {}
  await act(async () => root.render(<Probe onReady={(fn) => (set = fn)} />))
  expect(host.textContent).toBe('list')
  await act(async () => set('office'))
  expect(readViewState('test.id')).toBe('office')

  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<Probe onReady={(fn) => (set = fn)} />))
  expect(host.textContent).toBe('office')

  await act(async () => set(undefined))
  expect(readViewState('test.id')).toBeUndefined()
})

test('ignores invalid stored values', async () => {
  writeViewState('test.id', 42)
  await act(async () => root.render(<Probe onReady={() => {}} />))
  expect(host.textContent).toBe('list')
})
