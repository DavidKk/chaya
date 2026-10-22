'use client'

import { useEffect, useMemo, useState } from 'react'

import { DebugMenu } from '@/components/debug/DebugMenu'
import { useDebugMenuRegistration } from '@/components/debug/registry'
import { DownloadItemRow } from '@/components/downloads/DownloadItemRow'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { BergamotPackGuide } from '@/components/translate/BergamotPackGuide'
import { type DownloadItem, removeDownload, requestDownloadCenterOpen, upsertDownload } from '@/lib/downloads/store'
import type { MessageKey } from '@/lib/i18n'
import type { PackPlan } from '@/lib/translate/bergamot'

type Scenario = 'checking' | 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'unsupported'
const scenarios: Array<[Scenario, MessageKey]> = [
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
export function previewPlan(scenario: Scenario): PackPlan | undefined {
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

/** All actions are local presentation fixtures. No translation fetch or installer is mounted. */
export function BergamotDebug() {
  const t = useT()
  const [scenario, setScenario] = useState<Scenario>('missing')
  const [inCenter, setInCenter] = useState(false)
  const registration = useMemo(
    () => ({
      id: 'bergamot',
      title: 'Bergamot',
      actions: scenarios.map(([id, label]) => ({ id, label: t(label), run: () => setScenario(id) })),
    }),
    [t]
  )
  useDebugMenuRegistration(registration)
  const item: DownloadItem = {
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
    startedAt: 0,
  }
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
  return (
    <DebugMenu>
      <p className="m-0 rounded-lg bg-inset p-2 text-xs text-ink-soft">{t('debug.preview')}</p>
      <BergamotPackGuide plan={previewPlan(scenario)} onAction={(action) => setScenario(action === 'install' ? 'downloading' : 'missing')} />
      {scenario === 'downloading' || scenario === 'verifying' ? (
        <>
          <ul className="m-0 list-none rounded-lg bg-inset p-0">
            <DownloadItemRow item={item} />
          </ul>
          <Button size="xs" aria-pressed={inCenter} onClick={() => setInCenter((value) => !value)}>
            {inCenter ? t('common.close') : t('debug.downloadPreview')}
          </Button>
        </>
      ) : null}
    </DebugMenu>
  )
}
