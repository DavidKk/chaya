import type { TranslationPlayMode } from '@/lib/translate/play-settings'

import { hookMethod } from '../../helpers/game/method-hook'

/** Hook RM draw / message entry points so translate takes effect. */
type Translate = (text: unknown) => string
const ORIGINAL_MESSAGE_LINES = Symbol.for('chaya.originalMessageLines')

export function installEngineHooks(translate: Translate, getMode: () => TranslationPlayMode = () => 'pretranslated', observe: (text: string) => void = () => {}) {
  const base = Window_Base.prototype
  const preserveDialogue = (win: unknown) =>
    (getMode() === 'subtitle' && typeof Window_Message !== 'undefined' && win instanceof Window_Message) ||
    (getMode() !== 'pretranslated' && typeof Window_ChoiceList !== 'undefined' && win instanceof Window_ChoiceList)
  let preserveBitmap = false
  function render(text: string): string {
    const result = translate(text)
    if (result === text) observe(text)
    return result
  }
  function draw<T>(original: () => T): T {
    const previous = preserveBitmap
    preserveBitmap = true
    try {
      return original()
    } finally {
      preserveBitmap = previous
    }
  }
  const remove = [
    hookMethod(
      base,
      'convertEscapeCharacters',
      (original) =>
        function (text: string, ...args: unknown[]) {
          return original.call(this, preserveBitmap || preserveDialogue(this) ? text : render(text), ...args)
        }
    ),
    hookMethod(
      base,
      'drawText',
      (original) =>
        function (text: string, ...args: unknown[]) {
          const rendered = preserveBitmap || preserveDialogue(this) ? text : render(text)
          return draw(() => original.call(this, rendered, ...args))
        }
    ),
    hookMethod(
      base,
      'drawTextEx',
      (original) =>
        function (text: string, ...args: unknown[]) {
          const rendered = preserveBitmap || preserveDialogue(this) ? text : render(text)
          return draw(() => original.call(this, rendered, ...args))
        }
    ),
  ]
  if (typeof base.processNormalCharacter === 'function')
    remove.push(
      hookMethod(
        base,
        'processNormalCharacter',
        (original) =>
          function (...args: unknown[]) {
            return preserveDialogue(this) ? draw(() => original.apply(this, args)) : original.apply(this, args)
          }
      )
    )
  if (typeof Bitmap !== 'undefined')
    remove.push(
      hookMethod(
        Bitmap.prototype,
        'drawText',
        (original) =>
          function (text: string, ...args: unknown[]) {
            const rendered = preserveBitmap ? text : render(text)
            return draw(() => original.call(this, rendered, ...args))
          }
      )
    )
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    const canvas = CanvasRenderingContext2D.prototype
    remove.push(
      hookMethod(
        canvas,
        'measureText',
        (original) =>
          function (text: string, ...args: unknown[]) {
            return original.call(this, preserveBitmap ? text : translate(text), ...args)
          }
      )
    )
    for (const method of ['fillText', 'strokeText']) {
      remove.push(
        hookMethod(
          canvas,
          method,
          (original) =>
            function (text: string, ...args: unknown[]) {
              return original.call(this, preserveBitmap ? text : render(text), ...args)
            }
        )
      )
    }
  }
  if (typeof Game_Message !== 'undefined') {
    remove.push(
      hookMethod(
        Game_Message.prototype,
        'clear',
        (original) =>
          function (...args: unknown[]) {
            const result = original.apply(this, args)
            ;(this as Record<symbol, string[]>)[ORIGINAL_MESSAGE_LINES] = []
            return result
          }
      )
    )
    remove.push(
      hookMethod(
        Game_Message.prototype,
        'add',
        (original) =>
          function (text: string, ...args: unknown[]) {
            const source = this as Record<symbol, string[]>
            ;(source[ORIGINAL_MESSAGE_LINES] ??= []).push(text)
            return original.call(this, getMode() === 'pretranslated' ? translate(text) : text, ...args)
          }
      )
    )
    remove.push(
      hookMethod(
        Game_Message.prototype,
        'setChoices',
        (original) =>
          function (choices: string[], ...args: unknown[]) {
            const list = Array.isArray(choices) && getMode() === 'pretranslated' ? choices.map((c) => (c == null || c === '' ? c : translate(String(c)))) : choices
            return original.call(this, list, ...args)
          }
      )
    )
  }
  let active = true
  const manager = {
    translateIfNeed(value: string, cb: (t: string) => void) {
      cb(active ? translate(value) : value)
    },
  }
  if (window.TranslationManager === undefined) window.TranslationManager = manager
  return () => {
    active = false
    for (const dispose of remove.reverse()) dispose()
    if (typeof $gameMessage !== 'undefined') delete ($gameMessage as Record<symbol, string[]>)[ORIGINAL_MESSAGE_LINES]
    if (window.TranslationManager === manager) delete window.TranslationManager
  }
}
