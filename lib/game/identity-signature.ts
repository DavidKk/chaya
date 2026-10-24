import type { SupportedEngine } from './types'

export const IDENTITY_SIGNATURE_VERSION = 1 as const

export type GameIdentityBaseline = {
  gameId: string
  engine: SupportedEngine | 'unknown'
  title: string
  signatureBaseline: string
  signatureVersion: number
  boundPath: string
  firstBoundAt: number
  lastVerifiedAt: number
}

export type GameSignatureResult = {
  engine: SupportedEngine | 'unknown'
  title: string
  signature: string
  signatureVersion: number
  contentRoot: string
  sampledAt: number
}

export type VerificationStatus = 'MATCH' | 'DRIFT' | 'MISMATCH' | 'NO_BASELINE'

export type IdentityVerificationResult = {
  status: VerificationStatus
  gameId?: string
  baselineTitle?: string
  currentTitle: string
  baselineSignature?: string
  currentSignature: string
  details?: string
}

/** Verify current content signature against recorded baseline */
export function verifyIdentity(baseline: GameIdentityBaseline | null | undefined, current: GameSignatureResult): IdentityVerificationResult {
  if (!baseline || !baseline.signatureBaseline) {
    return {
      status: 'NO_BASELINE',
      currentTitle: current.title,
      currentSignature: current.signature,
      details: 'No baseline signature recorded for this game.',
    }
  }

  if (baseline.signatureBaseline === current.signature) {
    return {
      status: 'MATCH',
      gameId: baseline.gameId,
      baselineTitle: baseline.title,
      currentTitle: current.title,
      baselineSignature: baseline.signatureBaseline,
      currentSignature: current.signature,
    }
  }

  const baselineTitleNorm = (baseline.title || '').trim().toLowerCase()
  const currentTitleNorm = (current.title || '').trim().toLowerCase()
  const sameTitle = baselineTitleNorm.length > 0 && baselineTitleNorm === currentTitleNorm

  if (sameTitle) {
    return {
      status: 'DRIFT',
      gameId: baseline.gameId,
      baselineTitle: baseline.title,
      currentTitle: current.title,
      baselineSignature: baseline.signatureBaseline,
      currentSignature: current.signature,
      details: 'Game title matches but static content signature changed (possible patch or DLC).',
    }
  }

  return {
    status: 'MISMATCH',
    gameId: baseline.gameId,
    baselineTitle: baseline.title,
    currentTitle: current.title,
    baselineSignature: baseline.signatureBaseline,
    currentSignature: current.signature,
    details: 'Game signature and title conflict with baseline. Blocked from silent asset reuse.',
  }
}
