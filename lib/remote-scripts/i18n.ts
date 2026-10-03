import { type Locale, LOCALES } from '@/lib/i18n/locales'

import { REMOTE_SCRIPT_ORIGIN_PLACEHOLDER } from './command'

/**
 * Terminal copy for `/sh/*` scripts. A script embeds English as `M_<key>` and downloads
 * `/sh/i18n/<script>.<locale>.json` from the serving origin for other languages, falling back to English.
 * Values must not contain `"`, `\`, `%` (other than `%s`) or `${`; the script also drops downloaded values with `"` or `\`.
 */
export type ScriptMessages<K extends string = string> = Record<Locale, Record<K, string>>

export const SCRIPT_I18N_PREFIX = '/sh/i18n/'

export const scriptI18nFile = (script: string, locale: Locale) => `${script}.${locale}.json`

export function scriptI18nLocale(script: string, file: string): Locale | null {
  return LOCALES.find((locale) => scriptI18nFile(script, locale) === file) ?? null
}

const bashQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * Bash that sets `lang` and every `M_<key>`: CHAYA_LANG (set by the copied command) > LC_ALL / LC_MESSAGES / LANG > English.
 * Requires `curl`; reads packs with `plutil` (macOS), so elsewhere it silently stays English. Define `msg` to fill `%s`.
 */
export function bashI18nBlock(script: string, english: Record<string, string>): string {
  const defaults = Object.entries(english)
    .map(([key, value]) => `M_${key}=${bashQuote(value)}`)
    .join('\n')
  const url = `${REMOTE_SCRIPT_ORIGIN_PLACEHOLDER}${SCRIPT_I18N_PREFIX}${script}.`
  return `# Language: CHAYA_LANG (set by the copied command) > LC_ALL / LC_MESSAGES / LANG > English.
lang=''
for var in CHAYA_LANG LC_ALL LC_MESSAGES LANG; do
  lang=$(printenv "$var" || true)
  [ -z "$lang" ] || break
done
case "$lang" in
  zh*) lang=zh ;;
  ja*) lang=ja ;;
  ko*) lang=ko ;;
  *) lang=en ;;
esac

# Built-in English; other languages come as JSON from the server that served this script (falls back to English).
${defaults}
if [ "$lang" != en ]; then
  i18n=$(mktemp -t chaya-i18n.XXXXXX 2>/dev/null || true)
  if [ -n "$i18n" ] && curl --fail --silent --location --connect-timeout 10 --max-time 20 -o "$i18n" '${url}'"$lang.json" 2>/dev/null; then
    for key in ${Object.keys(english).join(' ')}; do
      value=$(plutil -extract "$key" raw -o - "$i18n" 2>/dev/null) || continue
      case "$value" in '' | *'"'* | *'\\'*) continue ;; esac
      printf -v "M_$key" '%s' "$value"
    done
  fi
  [ -z "$i18n" ] || rm -f "$i18n"
fi
# Fills %s placeholders of a message.
msg() { fmt=$1; shift; printf "$fmt" "$@"; }`
}
