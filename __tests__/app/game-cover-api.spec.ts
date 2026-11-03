import { GET } from '@/app/api/game/cover/route.server'

describe('GET /api/game/cover', () => {
  it('returns cover response payload', async () => {
    const res = await GET(new Request('http://localhost/api/game/cover'), { params: Promise.resolve({}) } as any)
    expect(res).toBeDefined()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect('cover' in data).toBe(true)
  })
})
