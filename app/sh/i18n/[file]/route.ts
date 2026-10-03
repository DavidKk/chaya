import { LOCALES } from '@/lib/i18n/locales'
import { scriptI18nFile } from '@/lib/remote-scripts/i18n'
import { getScriptI18nPack, SCRIPT_MESSAGES } from '@/lib/remote-scripts/registry'

/** Language packs for `/sh/*` scripts, fetched by the scripts at runtime. */
export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(SCRIPT_MESSAGES).flatMap((script) => LOCALES.map((locale) => ({ file: scriptI18nFile(script, locale) })))
}

export async function GET(_request: Request, ctx: RouteContext<'/sh/i18n/[file]'>) {
  const pack = getScriptI18nPack((await ctx.params).file)
  if (!pack) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(pack, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
