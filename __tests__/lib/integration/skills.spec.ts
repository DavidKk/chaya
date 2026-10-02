import { integrationSkillHref, isSkillId, skillInstallCommand, skillRawPath, SKILLS, splitFrontmatter } from '@/lib/integration/skills'
import { readSkill } from '@/services/integration/skills'

describe('integration skills', () => {
  it.each(SKILLS.map((skill) => skill.id))('%s ships a SKILL.md whose frontmatter name matches', (id) => {
    const { meta, body } = readSkill(id)
    expect(meta.name).toBe(id)
    expect(meta.description).toBeTruthy()
    expect(body.trim().length).toBeGreaterThan(200)
  })

  it('validates ids and builds paths', () => {
    expect(isSkillId('chaya-mcp')).toBe(true)
    expect(isSkillId('../etc/passwd')).toBe(false)
    expect(isSkillId(undefined)).toBe(false)
    expect(skillRawPath('chaya-mcp')).toBe('/skills/chaya-mcp.md')
    expect(integrationSkillHref('chaya-setup')).toBe('/integration/skills/chaya-setup')
  })

  it('installs into the selected agent skills dir', () => {
    expect(skillInstallCommand('https://example.com/', 'chaya-mcp', 'claude')).toBe(
      'mkdir -p ~/.claude/skills/chaya-mcp && curl -fsSL https://example.com/skills/chaya-mcp.md -o ~/.claude/skills/chaya-mcp/SKILL.md'
    )
  })

  it('splits frontmatter from the body', () => {
    expect(splitFrontmatter('---\nname: x\ndescription: a: b\n---\n# Title\n')).toEqual({ meta: { name: 'x', description: 'a: b' }, body: '# Title\n' })
    expect(splitFrontmatter('# No meta')).toEqual({ meta: {}, body: '# No meta' })
  })
})
