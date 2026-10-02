import { isSkillId, SKILLS } from '@/lib/integration/skills'
import { readSkillSource } from '@/services/integration/skills'

/** Public raw skill markdown (`/skills/<id>.md`) for `curl` installs; prerendered at build. */
export const dynamicParams = false

export function generateStaticParams() {
  return SKILLS.map((skill) => ({ file: `${skill.id}.md` }))
}

export async function GET(_request: Request, ctx: RouteContext<'/skills/[file]'>) {
  const { file } = await ctx.params
  const id = file.replace(/\.md$/, '')
  if (!isSkillId(id)) return new Response('not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(readSkillSource(id), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
