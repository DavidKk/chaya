import { LOCALES } from '@/lib/i18n/locales'
import { integrationSkillHref, isSkillId, skillInstallCommand, skillRawPath, SKILLS, splitFrontmatter } from '@/lib/integration/skills'
import { readSkill, readSkillBody } from '@/services/integration/skills'

describe('integration skills', () => {
  it.each(SKILLS.map((skill) => skill.id))('%s ships a SKILL.md whose frontmatter name matches', (id) => {
    const { meta, body } = readSkill(id)
    expect(meta.name).toBe(id)
    expect(meta.description).toBeTruthy()
    expect(body.trim().length).toBeGreaterThan(200)
  })

  it.each(SKILLS.map((skill) => skill.id))('%s agent copy is English and every locale has a display translation', (id) => {
    const { source } = readSkill(id)
    expect(source.replace(/`[^`\n]*`/g, '')).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/)
    expect(readSkillBody(id, 'en')).toBe(readSkill(id).body)
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      const body = readSkillBody(id, locale)
      expect(body).not.toBe(readSkill(id).body)
      expect(body.startsWith('---')).toBe(false)
    }
  })

  it('localizes every skill title and summary', () => {
    for (const skill of SKILLS) {
      for (const locale of LOCALES) {
        expect(skill.title[locale]).toBeTruthy()
        expect(skill.summary[locale]).toBeTruthy()
      }
    }
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
    expect(skillInstallCommand('https://example.com', 'chaya-setup', 'agents')).toBe(
      'mkdir -p ~/.agents/skills/chaya-setup && curl -fsSL https://example.com/skills/chaya-setup.md -o ~/.agents/skills/chaya-setup/SKILL.md'
    )
  })

  it('splits frontmatter from the body', () => {
    expect(splitFrontmatter('---\nname: x\ndescription: a: b\n---\n# Title\n')).toEqual({ meta: { name: 'x', description: 'a: b' }, body: '# Title\n' })
    expect(splitFrontmatter('# No meta')).toEqual({ meta: {}, body: '# No meta' })
  })
})
