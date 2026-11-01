/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { InstancePreview } from '@/components/remote-play/InstancePreview'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps using the slow preview after missing artwork and refreshes its URL at the next interval', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = (refreshKey: number) =>
    act(() => root.render(<InstancePreview libraryId="game" screenshotUrl="/api/remote/screenshot?roomId=room" refreshKey={refreshKey} title="Game" />))
  try {
    render(1)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/game/cover?gameId=game&raw=1')
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/remote/screenshot?roomId=room&t=1')
    render(2)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/remote/screenshot?roomId=room&t=2')
  } finally {
    act(() => root.unmount())
  }
})
