import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'

const visit = (path: string, headers?: Record<string, string>) => proxy(new NextRequest(`http://localhost:3927${path}`, { headers }))

describe('proxy', () => {
  it('serves raw skill markdown publicly', () => {
    const res = visit('/skills/chaya-mcp.md')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('lets every page through without login (API gate lives in defineApiRoute)', () => {
    for (const path of ['/', '/game', '/integration/skills/chaya-mcp', '/integration/mcp']) {
      const res = visit(path, { 'sec-fetch-site': 'cross-site' })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('rewrites remote script views for browsers', () => {
    const res = visit('/sh/setup', { accept: 'text/html' })
    expect(res.headers.get('x-middleware-rewrite')).toContain('/sh/setup/view')
  })
})
