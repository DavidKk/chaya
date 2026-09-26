/**
 * @jest-environment jsdom
 */
import { clearElement, setInnerHTML } from '@/plugins/src/helpers/ui/dom'

describe('helpers/ui/dom', () => {
  it('clearElement removes all child nodes', () => {
    const el = document.createElement('div')
    el.innerHTML = '<span>a</span><b>b</b>'
    clearElement(el)
    expect(el.childNodes.length).toBe(0)
  })

  it('setInnerHTML parses a fragment and can rewrite', () => {
    const el = document.createElement('div')
    setInnerHTML(el, '<p id="x">hi</p><span>y</span>')
    expect(el.querySelector('#x')?.textContent).toBe('hi')
    expect(el.children.length).toBe(2)
    setInnerHTML(el, '')
    expect(el.childNodes.length).toBe(0)
  })

  it('works the same on ShadowRoot', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    setInnerHTML(shadow, '<style>.a{}</style><div class="a"></div>')
    expect(shadow.querySelector('.a')).toBeTruthy()
    clearElement(shadow)
    expect(shadow.childNodes.length).toBe(0)
  })
})
