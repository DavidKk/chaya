'use client'

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

import { useDebugMenuRegistration } from '@/components/debug/registry'
import { useT } from '@/components/i18n/LocaleProvider'
import { BergamotPackGuide } from '@/components/translate/BergamotPackGuide'
import { removeDownload, requestDownloadCenterOpen, upsertDownload } from '@/lib/downloads/store'
import type { MessageKey } from '@/lib/i18n'
import type { PackPlan } from '@/lib/translate/bergamot'

export type BergamotDebugScenario = 'checking' | 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'unsupported'

const scenarios: Array<[BergamotDebugScenario, MessageKey]> = [
  ['checking', 'translate.offlineChecking'],
  ['missing', 'translate.tagNotReady'],
  ['downloading', 'translate.packDownloading'],
  ['verifying', 'translate.packVerifying'],
  ['ready', 'translate.tagReady'],
  ['failed', 'debug.failed'],
  ['unsupported', 'debug.unsupported'],
]
const ID = 'web:debug:bergamot'
const BYTES = 36745493

type BergamotDebugApi = {
  scenario: BergamotDebugScenario | null
  setScenario: (scenario: BergamotDebugScenario | null) => void
}

const BergamotDebugContext = createContext<BergamotDebugApi | null>(null)

export type BergamotDebugStatus = {
  installed?: boolean
  status?: string
  message?: string
  source?: string
  target?: string
  accessReason?: string
  consoleUrl?: string
}

/** Maps debug menu scenarios onto the engines detail offline sub-card. */
export function statusFor(scenario: BergamotDebugScenario): BergamotDebugStatus {
  if (scenario === 'checking') return { installed: false, status: 'checking', source: 'en', target: 'zh' }
  if (scenario === 'ready') return { installed: true, status: 'ready', source: 'en', target: 'zh' }
  if (scenario === 'unsupported') return { installed: false, status: 'unsupported', source: 'en', target: 'fr' }
  if (scenario === 'failed') return { installed: false, status: 'error', source: 'en', target: 'zh', message: 'preview-error' }
  if (scenario === 'downloading') return { installed: false, status: 'downloading', source: 'en', target: 'zh' }
  if (scenario === 'verifying') return { installed: false, status: 'verifying', source: 'en', target: 'zh' }
  return { installed: false, status: 'model_pack_missing', source: 'en', target: 'zh' }
}

export function previewPlan(scenario: BergamotDebugScenario): PackPlan | undefined {
  if (scenario === 'checking') return undefined
  const installed = scenario === 'ready'
  const active = scenario === 'downloading' || scenario === 'verifying'
  return {
    id: 'preview',
    source: 'en',
    target: 'zh',
    installed,
    status: installed ? 'ready' : scenario === 'unsupported' ? 'unsupported_pair' : 'model_pack_missing',
    canInstall: !installed && scenario !== 'unsupported',
    downloadBytes: BYTES,
    requiredFreeBytes: BYTES * 3,
    packs:
      scenario === 'unsupported'
        ? []
        : [{ id: 'preview-pack', source: 'en', target: 'zh', installed, bytes: BYTES, license: 'MPL-2.0', attribution: 'Mozilla Firefox Translations' }],
    job:
      active || scenario === 'failed'
        ? {
            id: 'preview-job',
            planId: 'preview',
            source: 'en',
            target: 'zh',
            packIds: ['preview-pack'],
            state: scenario === 'failed' ? 'failed' : 'running',
            phase: scenario === 'downloading' ? 'downloading' : 'validating',
            downloadedBytes: scenario === 'verifying' ? BYTES : Math.floor(BYTES * 0.42),
            totalDownloadBytes: BYTES,
            revision: 1,
            updatedAt: 0,
          }
        : undefined,
  }
}

/** Dev-only override for Bergamot offline UI on the real engines detail page. */
export function BergamotDebugProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<BergamotDebugScenario | null>(null)
  const value = useMemo(() => ({ scenario, setScenario }), [scenario])
  return <BergamotDebugContext.Provider value={value}>{children}</BergamotDebugContext.Provider>
}

export function useBergamotDebugScenario() {
  return useContext(BergamotDebugContext)
}

/** Inline guide for the engines detail page when a debug scenario is active. */
export function BergamotDebugGuide({ scenario }: { scenario: BergamotDebugScenario }) {
  const debug = useBergamotDebugScenario()
  return (
    <BergamotPackGuide
      plan={previewPlan(scenario)}
      embedded
      onAction={(action) => debug?.setScenario(action === 'install' || action === 'reinstall' ? 'downloading' : 'missing')}
    />
  )
}

/** Registers scenario switches in the debug menu; display stays on the page. */
export function BergamotDebug() {
  const t = useT()
  const debug = useBergamotDebugScenario()
  const scenario = debug?.scenario ?? null
  const [inCenter, setInCenter] = useState(false)
  const registration = useMemo(
    () => ({
      id: 'bergamot',
      title: 'Bergamot',
      actions: [
        ...scenarios.map(([id, label]) => ({
          id,
          label: t(label),
          active: scenario === id,
          run: () => debug?.setScenario(id),
        })),
        ...(scenario === 'downloading' || scenario === 'verifying'
          ? [
              {
                id: 'download-preview',
                label: inCenter ? t('common.close') : t('debug.downloadPreview'),
                active: inCenter,
                run: () => setInCenter((value) => !value),
              },
            ]
          : []),
        {
          id: 'live',
          label: t('debug.live'),
          active: scenario === null,
          run: () => debug?.setScenario(null),
          disabled: scenario === null,
        },
      ],
    }),
    [t, debug, scenario, inCenter]
  )
  useDebugMenuRegistration(registration)
  useEffect(() => {
    if (!inCenter || (scenario !== 'downloading' && scenario !== 'verifying')) {
      removeDownload(ID)
      return
    }
    upsertDownload({
      id: ID,
      channel: 'browser',
      kind: 'bergamot-pack',
      preview: true,
      source: 'en',
      target: 'zh',
      status: 'running',
      phase: scenario === 'verifying' ? 'install' : 'download',
      receivedBytes: scenario === 'verifying' ? BYTES : Math.floor(BYTES * 0.42),
      totalBytes: BYTES,
      startedAt: Date.now(),
    })
    requestDownloadCenterOpen()
    return () => removeDownload(ID)
  }, [inCenter, scenario])
  useEffect(() => {
    if (scenario !== 'downloading' && scenario !== 'verifying') setInCenter(false)
  }, [scenario])
  return null
}
