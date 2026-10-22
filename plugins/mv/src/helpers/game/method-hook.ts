type Method = (this: any, ...args: any[]) => any

/**
 * RPG Maker plugins commonly wrap earlier methods. Retire only our own behavior;
 * never overwrite a later plugin's wrapper, including wrappers holding our old function.
 */
export function hookMethod(target: object, key: string, create: (original: Method) => Method): () => void {
  const methods = target as Record<string, unknown>
  const original = methods[key]
  if (typeof original !== 'function') return () => {}
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  let implementation: Method | null = create(original as Method)
  const installed: Method = function (...args) {
    return (implementation || (original as Method)).apply(this, args)
  }
  methods[key] = installed
  return () => {
    // Drop closures referencing retired translation state even if another plugin keeps installed.
    implementation = null
    if (methods[key] !== installed) return
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
}
