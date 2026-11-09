import { NextResponse } from 'next/server'

import { openApiSpec } from '@/lib/integration/openapi-catalog'

export function GET(request: Request) {
  const host = request.headers.get('host') || '127.0.0.1:3000'
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const origin = `${proto}://${host}`
  return NextResponse.json(openApiSpec(origin), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}
