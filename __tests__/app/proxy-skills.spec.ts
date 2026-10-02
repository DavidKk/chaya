jest.mock('@/lib/service-mode/mode', () => ({ canUseDisk: () => true }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: () => false }))

import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'

const visit = (path: string) => proxy(new NextRequest(`http://127.0.0.1:3927${path}`))

describe('proxy without management access (local mode)', () => {
  it('serves raw skill markdown publicly', () => {
    const res = visit('/skills/chaya-mcp.md')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('keeps the integration pages behind auth', () => {
    expect(visit('/integration/skills/chaya-mcp').status).toBe(401)
    expect(visit('/integration/mcp').status).toBe(401)
  })
})
