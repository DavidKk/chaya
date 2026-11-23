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
  const NON_TEXT_RE = /^[\d\s+\-.,/\\:;%#!?()[\]<>=~'"*`^_]+$/
  let preserveBitmap = false
  function render(text: string): string {
    const result = translate(text)
    observe(text)
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
  const ticker = (window as Window & { TickerManager?: { show?: (text: string, ...args: unknown[]) => unknown } }).TickerManager
  if (ticker && typeof ticker.show === 'function')
    remove.push(
      hookMethod(
        ticker,
        'show',
        (original) =>
          function (text: string, ...args: unknown[]) {
            return draw(() => original.call(this, typeof text === 'string' ? render(text) : text, ...args))
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
            if (preserveBitmap || typeof text !== 'string' || !text || NON_TEXT_RE.test(text)) {
              return original.call(this, text, ...args)
            }
            return original.call(this, translate(text), ...args)
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
              if (preserveBitmap || typeof text !== 'string' || !text || NON_TEXT_RE.test(text)) {
                return original.call(this, text, ...args)
              }
              return original.call(this, render(text), ...args)
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
            const source = this as Record<symbol, string[]> & { _texts?: string[] }
            const translated = getMode() === 'pretranslated' ? translate(text) : text
            const before = source._texts?.length ?? 0
            const result = original.call(this, translated, ...args)
            // Game plugins wrapped inside this hook (e.g. localization keys → text) shape the real original line.
            const stored = translated === text ? (source._texts?.slice(before) ?? []) : []
            ;(source[ORIGINAL_MESSAGE_LINES] ??= []).push(...(stored.length ? stored : [text]))
            return result
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
  if (typeof Window_ActorCommand !== 'undefined' && Window_ActorCommand.prototype) {
    remove.push(
      hookMethod(
        Window_ActorCommand.prototype,
        'addCommand',
        (original) =>
          function (this: any, name: any, symbol: any, enabled = true, ext: any = null, ...args: unknown[]) {
            let safeName = name
            let safeExt = ext
            // Defensive fallback: skill command with invalid/missing stypeId fallback to primary skill type
            if (symbol === 'skill' && (typeof ext !== 'number' || ext <= 0)) {
              const actor = this._actor
              const types = actor && typeof actor.addedSkillTypes === 'function' ? actor.addedSkillTypes() : []
              safeExt = types.length > 0 ? types[0] : 1
              if (!safeName || safeName === 'undefined') {
                const sys = typeof globalThis !== 'undefined' ? (globalThis as any).$dataSystem : undefined
                safeName = (sys?.skillTypes && sys.skillTypes[safeExt]) || 'Skill'
              }
            }
            return original.call(this, safeName, symbol, enabled, safeExt, ...args)
          }
      )
    )
    remove.push(
      hookMethod(
        Window_ActorCommand.prototype,
        'makeCommandList',
        (original) =>
          function (this: any, ...args: unknown[]) {
            const res = original.apply(this, args)
            // Defensive fallback: if actor command list ended up empty due to broken plugin filters, add attack fallback
            if (Array.isArray(this._list) && this._list.length === 0 && this._actor) {
              if (typeof this.addAttackCommand === 'function') {
                this.addAttackCommand()
              } else if (typeof this.addCommand === 'function') {
                const tm = typeof globalThis !== 'undefined' ? (globalThis as any).TextManager : undefined
                const attackName = tm?.attack || 'Attack'
                const canAttack = typeof this._actor.canAttack === 'function' ? this._actor.canAttack() : true
                this.addCommand(attackName, 'attack', canAttack)
              }
            }
            return res
          }
      )
    )
  }
  if (typeof Window_SkillList !== 'undefined' && Window_SkillList.prototype) {
    remove.push(
      hookMethod(
        Window_SkillList.prototype,
        'setStypeId',
        (original) =>
          function (this: any, stypeId: any, ...args: unknown[]) {
            let safeId = stypeId
            // Defensive fallback: prevent opening empty skill list when stypeId is invalid or negative
            if (typeof stypeId === 'number' && stypeId <= 0) {
              const actor = this._actor
              const types = actor && typeof actor.addedSkillTypes === 'function' ? actor.addedSkillTypes() : []
              safeId = types.length > 0 ? types[0] : 1
            }
            return original.call(this, safeId, ...args)
          }
      )
    )
  }
  // Do not register third-party globals such as window.TranslationManager: game plugins may assume a complete API and call missing methods.
  return () => {
    for (const dispose of remove.reverse()) dispose()
    if (typeof $gameMessage !== 'undefined') delete ($gameMessage as Record<symbol, string[]>)[ORIGINAL_MESSAGE_LINES]
  }
}
