import { readCloudNwPackage, writeCloudWindow } from '@/lib/browser/cloud-window'
import { mergeNwPackageWindow } from '@/lib/game/nw-window'

function fakeDir(files: Record<string, string>) {
  const dir = {
    files,
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!(name in files) && !opts?.create) throw new DOMException('missing', 'NotFoundError')
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          let buf = ''
          return {
            write: async (text: string) => {
              buf += text
            },
            close: async () => {
              files[name] = buf
            },
          }
        },
      }
    },
  }
  return dir as unknown as FileSystemDirectoryHandle & { files: Record<string, string> }
}

describe('mergeNwPackageWindow', () => {
  it('keeps other fields and key order, fixes an empty name', () => {
    const next = mergeNwPackageWindow({ name: '', main: 'index.html', chromium: '--x', window: { width: 800 } }, { height: 600 }, 'fallback')
    expect(Object.keys(next)).toEqual(['name', 'main', 'chromium', 'window'])
    expect(next.name).toBe('fallback')
    expect(next.window).toMatchObject({ width: 800, height: 600 })
  })
})

describe('cloud window (FSA)', () => {
  it('reads package.json from the content root', async () => {
    const dir = fakeDir({ 'package.json': JSON.stringify({ name: 'demo', window: { width: 1380, height: 799, devtools: true } }) })
    expect(await readCloudNwPackage(dir)).toMatchObject({ name: 'demo', window: { width: 1380, height: 799, devtools: true } })
  })

  it('returns null when package.json is missing or invalid', async () => {
    expect(await readCloudNwPackage(fakeDir({}))).toBeNull()
    expect(await readCloudNwPackage(fakeDir({ 'package.json': '{oops' }))).toBeNull()
  })

  it('merges the window into the existing file', async () => {
    const dir = fakeDir({ 'package.json': JSON.stringify({ name: 'demo', main: 'index.html', window: { width: 816 } }) })
    const saved = await writeCloudWindow(dir, { width: 1280, fullscreen: true }, 'Demo Game')
    const written = JSON.parse(dir.files['package.json'])
    expect(written).toMatchObject({ name: 'demo', main: 'index.html', window: { width: 1280, fullscreen: true } })
    expect(saved.window.width).toBe(1280)
  })

  it('refuses to create package.json from the browser', async () => {
    const dir = fakeDir({})
    await expect(writeCloudWindow(dir, { width: 1280 }, 'Demo')).rejects.toThrow('package.json')
    expect(dir.files['package.json']).toBeUndefined()
  })
})
