/** @jest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server'

import { AI_SECTIONS, DEFAULT_AI_SECTION, isAiSection } from '@/components/ai/ai-sections'
import { AiRolesView } from '@/components/ai/AiRolesView'
import { AiShell } from '@/components/ai/AiShell'
import { GameEditAiPane } from '@/components/ai/GameEditAiPane'
import { RoleWorkspaceView } from '@/components/ai/RoleWorkspaceView'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { INTEGRATION_TABS, integrationTabFromPathname } from '@/components/integration/tabs'
import { mainNavFor } from '@/components/main-nav'
import { defaultRoleWorkspaceFileContent, deleteAiRole, generateCompanionIdleLine, loadAiRoles, saveAiRole } from '@/lib/game-agent/roles'

jest.mock('next/navigation', () => ({
  usePathname: () => '/ai/companion',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))
jest.mock('@/components/notification/useNotification', () => ({
  useNotification: () => ({ success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() }),
}))
jest.mock('@/components/confirm/ConfirmProvider', () => ({
  useConfirm: () => jest.fn().mockResolvedValue(true),
}))

describe('AI navigation and sections', () => {
  it('includes ai in both web and overlay main navigations', () => {
    expect(mainNavFor('web').map((i) => i.id)).toContain('ai')
    expect(mainNavFor('overlay').map((i) => i.id)).toContain('ai')
  })

  it('defines companion and agents under AI sections', () => {
    expect(AI_SECTIONS.map((s) => s.id)).toEqual(['companion', 'agents'])
    expect(DEFAULT_AI_SECTION).toBe('companion')
    expect(isAiSection('companion')).toBe(true)
    expect(isAiSection('agents')).toBe(true)
    expect(isAiSection('minimap')).toBe(false)
  })

  it('renders AiShell and GameEditAiPane with AI sections', () => {
    const webHtml = renderToStaticMarkup(
      <AiShell>
        <div>ai-content</div>
      </AiShell>
    )
    const overlayHtml = renderToStaticMarkup(<GameEditAiPane request={async () => new Response('{}')} />)

    expect(webHtml).toContain('ai-content')
    expect(overlayHtml).toBeTruthy()
  })

  it('renders AiRolesView safely when outside App Router context', () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AiRolesView roleId="rin" />
      </LocaleProvider>
    )
    expect(html).toContain('编辑旅伴: Rin')
    expect(html).toContain('打开角色空间')
  })

  it('replaces skills with openapi in INTEGRATION_TABS', () => {
    expect(INTEGRATION_TABS.map((t) => t.id)).toEqual(['mcp', 'webmcp', 'openapi'])
    expect(integrationTabFromPathname('/integration/openapi')).toBe('openapi')
    expect(integrationTabFromPathname('/integration/mcp')).toBe('mcp')
    expect(integrationTabFromPathname('/integration/webmcp')).toBe('webmcp')
  })

  it('renders companions as a list and supports left-right detail editing with role workspace', () => {
    const listHtml = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AiRolesView />
      </LocaleProvider>
    )
    expect(listHtml).toContain('旅伴')
    expect(listHtml).toContain('添加角色')
    expect(listHtml).toContain('角色')
    // Default names without personality suffix
    expect(listHtml).toContain('Nagi')
    expect(listHtml).not.toContain('Nagi · 温柔')
    // No DEFAULT badge
    expect(listHtml).not.toContain('Default')
    expect(listHtml).toContain('role="list"')
    expect(listHtml).toContain('role="listitem"')
    // Card list container with add button inside card
    expect(listHtml).toContain('data-companion-list-card')
    expect(listHtml).toContain('编辑')

    const detailHtml = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AiRolesView roleId="rin" />
      </LocaleProvider>
    )
    expect(detailHtml).toContain('编辑旅伴: Rin')
    expect(detailHtml).not.toContain('Rin · 活泼')
    expect(detailHtml).toContain('人设描述')
    expect(detailHtml).toContain('ACP / Agent 平台')
    expect(detailHtml).toContain('关联模型 (Model)')
    expect(detailHtml).toContain('角色空间')
    expect(detailHtml).toContain('打开角色空间')
    expect(detailHtml).not.toContain('动态台词库')
    expect(detailHtml).toContain('返回')
    expect(detailHtml).toContain('保存')

    const workspaceHtml = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <RoleWorkspaceView roleId="rin" />
      </LocaleProvider>
    )
    expect(workspaceHtml).toContain('角色空间')
    expect(workspaceHtml).toContain('AGENTS.md')
    expect(workspaceHtml).toContain('IDENTITY.md')
    expect(workspaceHtml).toContain('memory')
    expect(workspaceHtml).toContain('skills')
  })

  it('supports companion CRUD, role workspace templates, and dynamic idle lines', () => {
    const initial = loadAiRoles()
    expect(initial.length).toBeGreaterThanOrEqual(6)

    const testRole = {
      id: 'custom-hero',
      name: 'Custom Hero',
      gender: 'other' as const,
      avatar: 'hero',
      description: 'A courageous and righteous warrior.',
      provider: 'cursor' as const,
      model: 'auto',
      lines: [{ id: 'l1', scene: 'chest' as const, text: 'Found a chest!' }],
      idleLineGeneration: true,
    }
    saveAiRole(testRole)
    let roles = loadAiRoles()
    expect(roles.some((r) => r.id === 'custom-hero')).toBe(true)
    expect(roles.find((r) => r.id === 'custom-hero')?.description).toBe('A courageous and righteous warrior.')
    expect(roles.find((r) => r.id === 'custom-hero')?.avatar).toBe('hero')

    // edit description
    saveAiRole({ ...testRole, description: 'Updated fearless warrior.' })
    roles = loadAiRoles()
    expect(roles.find((r) => r.id === 'custom-hero')?.description).toBe('Updated fearless warrior.')

    // Role workspace template generation
    const agentsMd = defaultRoleWorkspaceFileContent('AGENTS.md', testRole)
    expect(agentsMd).toContain('Custom Hero')
    expect(agentsMd).toContain('cursor')

    // Dynamic idle line generation
    const idleLine = generateCompanionIdleLine(testRole)
    expect(idleLine.scene).toBe('idle')
    expect(idleLine.text).toBeTruthy()

    // delete
    deleteAiRole('custom-hero')
    roles = loadAiRoles()
    expect(roles.some((r) => r.id === 'custom-hero')).toBe(false)
  })
})
