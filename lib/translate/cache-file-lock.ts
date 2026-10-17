/** Cross-process lock shared by the local service and NW.js writers; no Node imports at runtime. */
type LockFs = Pick<typeof import('node:fs'), 'openSync' | 'writeFileSync' | 'readFileSync' | 'statSync' | 'unlinkSync' | 'closeSync'>
export function lockCacheFile(fs: LockFs, file: string): () => void {
  const name = `${file}.lock`
  let fd: number
  try {
    fd = fs.openSync(name, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let stale = false
    try {
      const pid = Number(fs.readFileSync(name, 'utf8'))
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
        } catch (e) {
          stale = (e as NodeJS.ErrnoException).code === 'ESRCH'
        }
      } else stale = Date.now() - fs.statSync(name).mtimeMs > 30_000
    } catch {
      /* A lock currently being created is not stale. */
    }
    if (!stale) throw new Error('翻译缓存正在写入，请稍后重试')
    fs.unlinkSync(name)
    fd = fs.openSync(name, 'wx')
  }
  try {
    fs.writeFileSync(fd, String(process.pid))
  } catch (e) {
    fs.closeSync(fd)
    fs.unlinkSync(name)
    throw e
  }
  return () => {
    fs.closeSync(fd)
    fs.unlinkSync(name)
  }
}

/** Caller holds lockCacheFile. Repair only an incomplete final row, preserving valid legacy tails. */
export function appendCacheLines(
  fs: Pick<typeof import('node:fs'), 'readFileSync' | 'appendFileSync' | 'truncateSync' | 'openSync' | 'fsyncSync' | 'closeSync'>,
  file: string,
  lines: unknown[]
): void {
  if (!lines.length) return
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  if (text && !text.endsWith('\n')) {
    const end = text.lastIndexOf('\n') + 1
    try {
      JSON.parse(text.slice(end))
      fs.appendFileSync(file, '\n')
    } catch {
      fs.truncateSync(file, Buffer.byteLength(text.slice(0, end)))
    }
  }
  fs.appendFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  const fd = fs.openSync(file, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
