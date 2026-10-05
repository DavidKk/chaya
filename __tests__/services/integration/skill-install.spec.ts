import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getSkillInstallStatus, installSkill, uninstallSkill } from '@/services/integration/skill-install'

describe('skill install', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-skill-'))
    jest.spyOn(os, 'homedir').mockReturnValue(home)
  })

  afterEach(() => jest.restoreAllMocks())

  test('install writes SKILL.md into the target dir and status follows', () => {
    expect(getSkillInstallStatus('chaya-mcp').claude.installed).toBe(false)
    installSkill('chaya-mcp', 'claude')
    const file = path.join(home, '.claude', 'skills', 'chaya-mcp', 'SKILL.md')
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^---\nname: chaya-mcp/)
    expect(getSkillInstallStatus('chaya-mcp')).toMatchObject({ claude: { installed: true }, agents: { installed: false } })
  })

  test('uninstall removes the file and the folder only when empty', () => {
    installSkill('chaya-setup', 'agents')
    const dir = path.join(home, '.agents', 'skills', 'chaya-setup')
    uninstallSkill('chaya-setup', 'agents')
    expect(fs.existsSync(dir)).toBe(false)

    installSkill('chaya-setup', 'agents')
    fs.writeFileSync(path.join(dir, 'notes.md'), 'mine')
    uninstallSkill('chaya-setup', 'agents')
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'notes.md'))).toBe(true)
  })
})
