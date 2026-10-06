/** @jest-environment jsdom */
import { installSvgImageText } from '@/plugins/src/translator/engine/svg-image-text'

it('translates SVG image labels from original text and refreshes an existing image', () => {
  const translations = new Map<string, string>()
  const observed: string[] = []
  let changed: (() => void) | undefined
  const images = installSvgImageText({
    translate: (text) => translations.get(text) || text,
    observe: (text) => observed.push(text),
    subscribe: (listener) => {
      changed = listener
      return () => {
        changed = undefined
      }
    },
  })
  try {
    const image = new Image()
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>敵の攻撃</text></svg>')}`
    image.src = source
    expect(observed).toEqual(['敵の攻撃'])
    translations.set('敵の攻撃', '敌人攻击')
    changed?.()
    expect(decodeURIComponent(image.src)).toContain('敌人攻击')
    expect(decodeURIComponent(image.src)).not.toContain('敵の攻撃')
    translations.delete('敵の攻撃')
    images.refresh()
    expect(image.src).toBe(source)
    images.dispose()
    image.src = source
    expect(image.src).toBe(source)
  } finally {
    images.dispose()
  }
})
