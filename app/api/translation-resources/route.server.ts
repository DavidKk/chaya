import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { createResourceMatcher } from '@/lib/translate/resource-matcher'
import { canonicalResourceLanguage, type ResourceContext, type ResourceSnapshot } from '@/lib/translate/resource-types'
import { requireDisk } from '@/services/disk-ops'
import { storageCall } from '@/services/storage/client'
import { RESOURCE_LIMITS } from '@/services/translate/resources/validate'

export const runtime = 'nodejs'

// JSON escaping can expand each content byte sixfold. Bound the stream before parsing.
const MAX_BODY_BYTES = RESOURCE_LIMITS.bytes * 6 + 4096
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error('Expected resource request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new Error('Resource request exceeds size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected resource request object')
  return body as Record<string, unknown>
}

function text(value: unknown, label: string, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`)
  return value
}

/** Local resource management uses the same single writer as the CLI, without remote downloads. */
export const GET = defineApiRoute('get:/api/translation-resources', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  try {
    const params = new URL(request.url).searchParams
    const action = params.get('action') || 'list'
    if (action === 'list') return apiOk({ packages: storageCall('resources.list') })
    if (action === 'export') {
      const content = storageCall<string>('resources.export', [text(params.get('packId'), 'pack ID'), text(params.get('version'), 'version')])
      return new Response(content, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    return apiBadRequest('Unknown resource action')
  } catch (error) {
    return apiBadRequest(error instanceof Error ? error.message : String(error), 'RESOURCE_REJECTED')
  }
})

export const POST = defineApiRoute('post:/api/translation-resources', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  try {
    const body = await readBody(request)
    if (body.action === 'preview' || body.action === 'apply' || body.action === 'import') {
      const content = text(body.content, 'JSONL content', RESOURCE_LIMITS.bytes)
      if (Buffer.byteLength(content, 'utf8') > RESOURCE_LIMITS.bytes) throw new Error('Resource package exceeds size limit')
      if (body.action === 'preview') return apiOk({ preview: storageCall('resources.preview', [content]) })
      const token = body.action === 'import' ? storageCall<{ token: string }>('resources.preview', [content]).token : text(body.token, 'preview token')
      return apiOk({ result: storageCall('resources.apply', [content, token]) })
    }
    if (body.action === 'activate' || body.action === 'rollback') {
      return apiOk({ result: storageCall('resources.activate', [text(body.packId, 'pack ID'), text(body.version, 'version')]) })
    }
    if (body.action === 'disable') return apiOk({ result: storageCall('resources.disable', [text(body.packId, 'pack ID')]) })
    if (body.action === 'lookup') {
      const context: ResourceContext = {
        sourceLanguage: canonicalResourceLanguage(text(body.sourceLanguage, 'source language')),
        targetLanguage: canonicalResourceLanguage(text(body.targetLanguage, 'target language')),
      }
      for (const key of ['gameId', 'category', 'speaker', 'scene'] as const) {
        if (body[key] !== undefined) context[key] = text(body[key], key, 200)
      }
      const source = text(body.text, 'text', 16000)
      const snapshot = storageCall<ResourceSnapshot>('resources.snapshot')
      return apiOk({ revision: snapshot.revision, hit: createResourceMatcher(snapshot).match(source, context) })
    }
    return apiBadRequest('Unknown resource action')
  } catch (error) {
    return apiBadRequest(error instanceof Error ? error.message : String(error), 'RESOURCE_REJECTED')
  }
})
