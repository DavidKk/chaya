/** Translate literal text in data-URL SVGs before the image is rasterized. */
export function installSvgImageText(options: { translate: (text: string) => string; observe: (text: string) => void; subscribe: (listener: () => void) => () => void }) {
  if (typeof HTMLImageElement === 'undefined' || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return { refresh: () => {}, dispose: () => {} }
  const prototype = HTMLImageElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src')
  if (!descriptor?.get || !descriptor.set || !descriptor.configurable) return { refresh: () => {}, dispose: () => {} }
  const records = new Map<HTMLImageElement, string>()
  let active = true

  function translatedSource(source: string) {
    const comma = source.indexOf(',')
    if (comma < 0 || comma > 80 || source.length > 100_000 || !/^data:image\/svg\+xml(?:;[^,]*)?$/i.test(source.slice(0, comma)) || /;base64/i.test(source.slice(0, comma)))
      return source
    try {
      const xml = decodeURIComponent(source.slice(comma + 1))
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml')
      if (document.querySelector('parsererror')) return source
      let changed = false
      for (const element of document.querySelectorAll('text, tspan')) {
        if (element.children.length) continue
        const original = element.textContent || ''
        if (!original.trim()) continue
        const translated = options.translate(original)
        if (translated === original) options.observe(original)
        else {
          element.textContent = translated
          changed = true
        }
      }
      return changed ? `${source.slice(0, comma + 1)}${encodeURIComponent(new XMLSerializer().serializeToString(document))}` : source
    } catch {
      return source
    }
  }

  const installed: PropertyDescriptor = {
    ...descriptor,
    get() {
      return descriptor.get!.call(this)
    },
    set(this: HTMLImageElement, source: string) {
      const raw = String(source)
      if (active && /^data:image\/svg\+xml/i.test(raw)) {
        records.delete(this)
        records.set(this, raw)
        if (records.size > 128) records.delete(records.keys().next().value!)
        descriptor.set!.call(this, translatedSource(raw))
      } else {
        records.delete(this)
        descriptor.set!.call(this, source)
      }
    },
  }
  Object.defineProperty(prototype, 'src', installed)
  const refresh = () => {
    if (!active) return
    for (const [image, source] of records) {
      const next = translatedSource(source)
      if (descriptor.get!.call(image) !== next) descriptor.set!.call(image, next)
    }
  }
  const unsubscribe = options.subscribe(refresh)
  const dispose = () => {
    active = false
    unsubscribe()
    records.clear()
    if (Object.getOwnPropertyDescriptor(prototype, 'src')?.set === installed.set) Object.defineProperty(prototype, 'src', descriptor)
  }
  return { refresh, dispose }
}
