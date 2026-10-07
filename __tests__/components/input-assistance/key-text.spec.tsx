import { renderToStaticMarkup } from 'react-dom/server'

import { hasKeyIcon, KeyText } from '@/components/input-assistance/KeyText'

function iconLabels(text: string): string[] {
  return [...renderToStaticMarkup(<KeyText text={text} />).matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])
}

it('renders modifier words and Mac symbols as icons', () => {
  expect(iconLabels('Ctrl+Shift+Alt+Fn+Q')).toEqual(['Ctrl', '加', 'Shift', '加', 'Alt', '加', 'Fn', '加', 'Q'])
  expect(iconLabels('⌥⇧⌘A')).toEqual(['Alt', 'Shift', 'Cmd', 'A'])
  expect(iconLabels('⌃')).toEqual(['Ctrl'])
})

it('keeps other multi-letter key names as text', () => {
  const html = renderToStaticMarkup(<KeyText text="Space" />)
  expect(html).toBe('Space')
  expect(hasKeyIcon('Space')).toBe(false)
  expect(hasKeyIcon('Meta+Space')).toBe(true)
})
