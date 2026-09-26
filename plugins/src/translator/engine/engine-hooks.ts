import type { TranslationPlayMode } from '@/lib/translate/play-settings'

import { hookMethod } from '../../helpers/game/method-hook'

/** Hook RM draw / message entry points so translate takes effect. */
type Translate = (text: unknown) => string

export function installEngineHooks(translate: Translate, getMode: () => TranslationPlayMode = () => 'pretranslated') {
  const base = Window_Base.prototype
  const preserveDialogue = (win: unknown) =>
    (getMode() === 'subtitle' && typeof Window_Message !== 'undefined' && win instanceof Window_Message) ||
    (getMode() !== 'pretranslated' && typeof Window_ChoiceList !== 'undefined' && win instanceof Window_ChoiceList)
  let preserveBitmap = false
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
          return original.call(this, preserveBitmap || preserveDialogue(this) ? text : translate(text), ...args)
        }
    ),
    hookMethod(
      base,
      'drawText',
      (original) =>
        function (text: string, ...args: unknown[]) {
          const rendered = preserveBitmap || preserveDialogue(this) ? text : translate(text)
          return draw(() => original.call(this, rendered, ...args))
        }
    ),
    hookMethod(
      base,
      'drawTextEx',
      (original) =>
        function (text: string, ...args: unknown[]) {
          const rendered = preserveBitmap || preserveDialogue(this) ? text : translate(text)
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
            return original.call(this, preserveBitmap ? text : translate(text), ...args)
          }
      )
    )
  if (typeof Game_Message !== 'undefined') {
    remove.push(
      hookMethod(
        Game_Message.prototype,
        'add',
        (original) =>
          function (text: string, ...args: unknown[]) {
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
    if (window.TranslationManager === manager) delete window.TranslationManager
  }
}
