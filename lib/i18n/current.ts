import { detectBrowserLocale, type Locale, readStoredLocale } from '@/lib/i18n/locales'
import { MESSAGES } from '@/lib/i18n/messages'
import { type MessageKey, type MessageParams, translate } from '@/lib/i18n/t'

/** 组件外（游戏内提示、抛给页面的报错）取当前界面语言；规则同 `LocaleProvider`：明确选择优先，否则跟随浏览器 */
export function currentLocale(): Locale {
  if (typeof window === 'undefined') return detectBrowserLocale()
  return readStoredLocale() ?? detectBrowserLocale()
}

/** 组件外的文案读取；组件内用 `useT` */
export function tNow(key: MessageKey, params?: MessageParams): string {
  return translate(MESSAGES[currentLocale()], key, params)
}
