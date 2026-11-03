import fs from 'node:fs'
import path from 'node:path'

import { POST } from '@/app/api/reveal/route.server'
import * as diskOps from '@/services/disk-ops'

jest.mock('@/services/disk-ops', () => ({
  requireDisk: jest.fn(() => null),
  getResolvedFromConfig: jest.fn(() => ({
    ok: true,
    hasShell: true,
    shellApp: '/data/shell/nwjs.app',
    contentRoot: '/game/www',
    projectRoot: '/game',
  })),
  openInFinder: jest.fn(async () => {}),
  revealInFinder: jest.fn(async () => {}),
}))

const ctx = { params: Promise.resolve({}) }

describe('POST /api/reveal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(diskOps.requireDisk as jest.Mock).mockReturnValue(null)
  })

  it('returns 404 when requested path does not exist', async () => {
    const req = new Request('http://localhost:3000/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/non/existent/path/for/sure' }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.message).toContain('路径不存在')
  })

  it('calls openInFinder when opening an existing directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'reveal-test-dir-'))
    try {
      const req = new Request('http://localhost:3000/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tmpDir }),
      })
      const res = await POST(req, ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.path).toBe(tmpDir)
      expect(diskOps.openInFinder).toHaveBeenCalledWith(tmpDir)
      expect(diskOps.revealInFinder).not.toHaveBeenCalled()
    } finally {
      fs.rmdirSync(tmpDir)
    }
  })

  it('calls revealInFinder when opening an existing file', async () => {
    const tmpFile = path.join(fs.realpathSync('/tmp'), `reveal-test-file-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')
    try {
      const req = new Request('http://localhost:3000/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tmpFile }),
      })
      const res = await POST(req, ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.path).toBe(tmpFile)
      expect(diskOps.revealInFinder).toHaveBeenCalledWith(tmpFile)
      expect(diskOps.openInFinder).not.toHaveBeenCalled()
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('resolves from config when path is omitted', async () => {
    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'reveal-project-'))
    ;(diskOps.getResolvedFromConfig as jest.Mock).mockReturnValue({
      ok: true,
      hasShell: true,
      shellApp: '/data/shell/nwjs.app',
      contentRoot: tmpDir,
      projectRoot: tmpDir,
    })
    try {
      const req = new Request('http://localhost:3000/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'project' }),
      })
      const res = await POST(req, ctx)
      expect(res.status).toBe(200)
      expect(diskOps.openInFinder).toHaveBeenCalledWith(tmpDir)
    } finally {
      fs.rmdirSync(tmpDir)
    }
  })
})
