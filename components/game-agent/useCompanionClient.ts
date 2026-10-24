'use client'

import { useCallback } from 'react'

import type { CompanionHostRequest } from '@/lib/runtime/companion-protocol'

import type { GameAgentRequest } from './GameAgentWorkspace'

export type CompanionClientError = Error & {
  code: string
  retryable: boolean
  status?: number
}

export function companionResponseError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown; code?: unknown; retryable?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

export function toCompanionClientError(body: unknown, fallback: string, status?: number): CompanionClientError {
  const value = body as { error?: { message?: unknown; code?: unknown; retryable?: unknown } } | null
  const error = new Error(companionResponseError(body, fallback)) as CompanionClientError
  error.code = typeof value?.error?.code === 'string' && value.error.code ? value.error.code : status === 409 ? 'REQUEST_CONFLICT' : 'COMPANION_REQUEST_FAILED'
  error.retryable = typeof value?.error?.retryable === 'boolean' ? value.error.retryable : status === 409 || status === 429 || (typeof status === 'number' && status >= 500)
  error.status = status
  return error
}

export function isCompanionAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function isCapabilityUnsupported(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'CAPABILITY_UNSUPPORTED')
}

export function useCompanionClient(gameId: string, request: GameAgentRequest) {
  return useCallback(
    async <T>(message: CompanionHostRequest, signal?: AbortSignal): Promise<T> => {
      const response = await request('/api/game-agent/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, message }),
        signal,
      })
      const body = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string; code?: string; retryable?: boolean } } | null
      if (!response.ok) throw toCompanionClientError(body, `HTTP ${response.status}`, response.status)
      return body?.result as T
    },
    [gameId, request]
  )
}
