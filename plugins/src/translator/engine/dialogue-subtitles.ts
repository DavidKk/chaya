import { peelChoiceMetaTrail } from '@/lib/translate/choice-meta'
import type { TranslationPlaySettings } from '@/lib/translate/play-settings'
import { containsJapaneseText, isStorableTranslation } from '@/services/translate/text-classify'

import { hookMethod } from '../../helpers/game/method-hook'

type Message = { _texts?: string[]; _choices?: string[]; isChoiceHelp?: () => boolean }
export type Subtitle = {
  text: string
  choices: string[]
  choiceHelp?: boolean
  replace?: boolean
  pending?: boolean
  badge?: 'cached' | 'translated' | 'partial' | 'untranslated' | 'skipped'
}
export type DialogueActivity = { level: 'info' | 'ok' | 'warn' | 'fail'; text: string; status?: string }
type Options = {
  settings: () => TranslationPlaySettings
  cached: (text: string) => string
  request: (texts: string[], signal: AbortSignal) => Promise<Array<{ src: string; zh: string | null; engine?: string; error?: string }>>
  show: (subtitle: Subtitle | null, messageWindow?: InstanceType<typeof Window_Message>) => void
  status: (pending: boolean, error?: string) => void
  activity?: (event: DialogueActivity) => void
}

const MAX_LIVE_CHARS = 360

/** 只翻译当前仍在屏幕上的短对话；显示策略由调用方选择。 */
export function createDialogueSubtitles(options: Options) {
  let active: { message: Message; key: string; abort: AbortController; timer: ReturnType<typeof setTimeout> } | null = null
  const keyOf = (message: Message) => JSON.stringify([message._texts || [], message._choices || []])

  function reset() {
    const previous = active
    active = null
    if (previous) {
      clearTimeout(previous.timer)
      previous.abort.abort()
    }
    options.show(null)
    options.status(false)
  }

  function begin(message: Message, messageWindow?: InstanceType<typeof Window_Message>) {
    const mode = options.settings().mode
    if (mode !== 'realtime' && mode !== 'subtitle') {
      reset()
      return
    }
    const key = keyOf(message)
    if (active?.message === message && active.key === key) return
    reset()

    const lines = [...(message._texts || [])]
    const text = lines.join('\n')
    const choiceHelp = message.isChoiceHelp?.() === true
    // 悬停说明只翻译当前项，不因整组选项过多而跳过，也不为每次移动重发其它选项。
    const choices = choiceHelp ? [] : [...(message._choices || [])]
    const wholeHit = options.cached(text)
    const lineHits = lines.map((line) => {
      const hit = options.cached(line)
      return hit !== line && !isStorableTranslation(line, hit) ? line : hit
    })
    // 词干/逐行查表可能只替换了部分内容；残留假名时不能宣称整段已命中。
    const useWholeHit = wholeHit !== text && isStorableTranslation(text, wholeHit) && (wholeHit !== lineHits.join('\n') || lineHits.every((hit, index) => hit === lines[index]))
    const choiceHits = choices.map((choice) => {
      const hit = options.cached(choice)
      return hit !== choice && !isStorableTranslation(choice, hit) ? choice : hit
    })
    const cachedHit = useWholeHit || lineHits.some((hit, index) => hit !== lines[index]) || choiceHits.some((hit, index) => hit !== choices[index])
    const subtitle = (translated: Map<string, string>, asyncText = false): Subtitle => ({
      ...(mode === 'realtime' ? { replace: true } : {}),
      ...(choiceHelp ? { choiceHelp: true } : {}),
      text: (() => {
        const rendered = useWholeHit ? wholeHit : lines.map((line, index) => translated.get(line) || lineHits[index]).join('\n')
        return rendered !== text && (mode === 'subtitle' || asyncText) ? rendered : ''
      })(),
      choices: choices.map((choice, index) => {
        const rendered = translated.get(choice) || choiceHits[index]
        return rendered !== choice ? peelChoiceMetaTrail(rendered).core : ''
      }),
    })
    const hasSubtitle = (value: Subtitle) => Boolean(value.text || value.choices.some(Boolean))
    const missingLines = useWholeHit ? [] : [...new Set(lines.filter((line, index) => containsJapaneseText(line) && lineHits[index] === line))]
    const missingChoices = [...new Set(choices.filter((choice, index) => containsJapaneseText(choice) && choiceHits[index] === choice))]
    const initial = subtitle(new Map())
    const publish = (value: Subtitle, pending: boolean, badge?: Subtitle['badge']) => {
      if (hasSubtitle(value) || pending || badge) options.show({ ...value, ...(pending ? { pending: true } : {}), ...(badge ? { badge } : {}) }, messageWindow)
      else options.show(null)
    }
    if (!text.trim() && !choices.some((choice) => choice.trim())) return
    if (!missingLines.length && !missingChoices.length) {
      publish(initial, false, cachedHit ? 'cached' : 'skipped')
      options.activity?.({
        level: cachedHit ? 'ok' : 'info',
        text: `${cachedHit ? '词库命中' : '无需翻译'}：${(text || choices[0] || '').slice(0, 70)}`,
        status: cachedHit ? '词库命中' : '无需翻译',
      })
      return
    }
    if (text.length + choices.join('').length > MAX_LIVE_CHARS || choices.length > 7) {
      publish(initial, false, 'skipped')
      options.activity?.({ level: 'warn', text: `内容过长，跳过实时翻译：${(text || choices[0] || '').slice(0, 70)}`, status: '已跳过' })
      return
    }

    const abort = new AbortController()
    let timedOut = false
    const entry = {
      message,
      key,
      abort,
      timer: setTimeout(() => {
        timedOut = true
        abort.abort()
      }, options.settings().timeoutMs),
    }
    active = entry
    let latest = initial
    publish(initial, true)
    options.status(true)
    options.activity?.({ level: 'info', text: `翻译中：${(text || choices[0] || '').slice(0, 70)}`, status: '翻译中' })
    void (async () => {
      const translated = new Map<string, string>()
      let asyncText = false
      let failure = ''
      const groups = [missingLines, missingChoices]
      try {
        for (const group of groups) {
          if (!group.length || abort.signal.aborted) continue
          const items = await options.request(group, abort.signal)
          if (active !== entry || abort.signal.aborted || keyOf(message) !== key || options.settings().mode !== mode) return
          for (const item of items) {
            if (item.zh && item.zh !== item.src) {
              translated.set(item.src, item.zh)
              options.activity?.({ level: 'ok', text: `${item.engine || '本机'}：${item.src.slice(0, 45)} → ${item.zh.slice(0, 45)}` })
            } else if (item.error) {
              options.activity?.({ level: 'warn', text: `${item.src.slice(0, 45)}：${item.error}` })
            }
          }
          const failed = items.find((item) => !item.zh && item.error)
          if (failed?.error) failure = failed.error
          if (group === missingLines && items.some((item) => item.zh && item.zh !== item.src)) asyncText = true
          const next = subtitle(translated, asyncText)
          latest = next
          publish(next, true)
        }
      } catch (error) {
        if (active === entry && !abort.signal.aborted) failure = error instanceof Error ? error.message : '本地翻译失败'
      } finally {
        if (active !== entry) return
        clearTimeout(entry.timer)
        const missing = [...missingLines, ...missingChoices]
        const badge = missing.every((src) => translated.has(src)) ? 'translated' : cachedHit || translated.size ? 'partial' : 'untranslated'
        if (options.settings().mode === mode) publish(latest, false, badge)
        else options.show(null)
        const error = badge === 'translated' ? undefined : failure || (timedOut ? '实时翻译超时；可调高翻译超时或检查本地模型' : undefined)
        options.status(false, error)
        options.activity?.({
          level: badge === 'translated' ? 'ok' : 'warn',
          text: `${badge === 'translated' ? '翻译完成' : error || '部分或全部未译'}：${(text || choices[0] || '').slice(0, 70)}`,
          status: badge === 'translated' ? '已译' : badge === 'partial' ? '部分未译' : '未译',
        })
      }
    })()
  }
  return { begin, reset }
}

export function installDialogueSubtitles(options: Options) {
  if (typeof Window_Message === 'undefined' || typeof Game_Message === 'undefined') return
  const host = window as Window & { __chayaDialogueCleanup?: () => void }
  host.__chayaDialogueCleanup?.()
  let sourceChoices: string[] = []
  let renderedChoices: string[] = []
  let choiceOwner: Message | null = null
  const display: Options['show'] = (value, messageWindow) => {
    if (value?.replace) {
      choiceOwner = $gameMessage
      sourceChoices = [...($gameMessage._choices || [])]
      renderedChoices = value.choices
      const choiceWindow = messageWindow?._choiceWindow || messageWindow?._choiceListWindow
      if (choiceWindow?.active) choiceWindow.refresh?.()
    } else {
      choiceOwner = null
      sourceChoices = []
      renderedChoices = []
    }
    if (value) options.show(value, messageWindow)
    else options.show(null)
  }
  const subtitles = createDialogueSubtitles({ ...options, show: display })
  const proto = Window_Message.prototype
  const remove = [
    hookMethod(
      proto,
      'startMessage',
      (original) =>
        function (...args: unknown[]) {
          subtitles.reset()
          const result = original.apply(this, args)
          subtitles.begin($gameMessage, this)
          return result
        }
    ),
    hookMethod(
      proto,
      'startInput',
      (original) =>
        function (...args: unknown[]) {
          const result = original.apply(this, args)
          if ($gameMessage.isChoice()) subtitles.begin($gameMessage, this)
          return result
        }
    ),
    hookMethod(
      Game_Message.prototype,
      'clear',
      (original) =>
        function (...args: unknown[]) {
          subtitles.reset()
          return original.apply(this, args)
        }
    ),
    hookMethod(
      proto,
      'forceClear',
      (original) =>
        function (...args: unknown[]) {
          subtitles.reset()
          return original.apply(this, args)
        }
    ),
  ]
  if (typeof Window_ChoiceList !== 'undefined') {
    remove.push(
      hookMethod(
        Window_ChoiceList.prototype,
        'commandName',
        (original) =>
          function (index: number) {
            const name = original.call(this, index)
            if (options.settings().mode !== 'realtime') return name
            if (choiceOwner === $gameMessage && sourceChoices[index] === $gameMessage._choices?.[index] && renderedChoices[index]) return renderedChoices[index]
            const cached = options.cached(name)
            return cached !== name ? peelChoiceMetaTrail(cached).core : name
          }
      )
    )
  }
  host.__chayaDialogueCleanup = () => {
    for (const dispose of remove.reverse()) dispose()
    subtitles.reset()
  }
}
