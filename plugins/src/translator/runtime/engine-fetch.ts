import { tryNodeRequire } from '../../helpers/node/node-require'

/** 引擎由游戏进程直接访问，不受 file:// 页面的跨域限制；不携带 Chaya 授权凭据。 */
export async function engineFetch(url: string, init: RequestInit = {}, redirects = 0): Promise<Response> {
  const require = tryNodeRequire()
  if (!require) return fetch(url, init)
  if (init.signal?.aborted) throw new Error('翻译已取消')
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('不支持的翻译地址')
  const http = require(target.protocol === 'https:' ? 'https' : 'http') as typeof import('http')
  return new Promise((resolve, reject) => {
    const body = typeof init.body === 'string' ? init.body : undefined
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const req = http.request(url, { method: init.method || 'GET', headers: { ...headers, ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) } }, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        cleanup()
        if (redirects >= 3) {
          reject(new Error('翻译地址重定向过多'))
          return
        }
        const next = new URL(res.headers.location, url)
        if (next.protocol !== 'https:' && target.protocol === 'https:') {
          reject(new Error('翻译地址重定向无效'))
          return
        }
        const nextInit = res.statusCode === 307 || res.statusCode === 308 ? init : { ...init, method: 'GET', body: undefined }
        resolve(engineFetch(next.href, nextInit, redirects + 1))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 8 * 1024 * 1024) req.destroy(new Error('翻译响应过大'))
        else chunks.push(chunk)
      })
      res.on('error', (error) => {
        cleanup()
        reject(error)
      })
      res.on('end', () => {
        cleanup()
        resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: res.statusCode || 502 }))
      })
    })
    const cancel = () => req.destroy(new Error('翻译已取消'))
    const cleanup = () => init.signal?.removeEventListener('abort', cancel)
    init.signal?.addEventListener('abort', cancel, { once: true })
    req.setTimeout(30_000, () => req.destroy(new Error('翻译请求超时')))
    req.on('error', (error) => {
      cleanup()
      reject(error)
    })
    if (body) req.write(body)
    req.end()
  })
}
