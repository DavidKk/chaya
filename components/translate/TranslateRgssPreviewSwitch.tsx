'use client'

import { useCallback, useEffect, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Switch } from '@/components/sk'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import type { RgssPreviewView } from '@/lib/translate/rgss-preview'

type PreviewState = {
  view: RgssPreviewView
  isRgss: boolean
  contentRoot: string
}

/** Seed: toggle in-game runtime lookup (MV-style); does not rewrite Data. */
export function TranslateRgssPreviewSwitch() {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const [state, setState] = useState<PreviewState | null>(null)
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rgss-preview' }),
      })
      const data = (await res.json()) as PreviewState & { ok?: boolean; error?: unknown }
      if (!res.ok) throw new Error(readApiErrorMessage(data))
      if (!data.isRgss) {
        setState(null)
        return
      }
      setState({
        view: data.view === 'original' ? 'original' : 'translated',
        isRgss: true,
        contentRoot: data.contentRoot || '',
      })
    } catch {
      setState(null)
    }
  }, [translationFetch])

  useEffect(() => {
    void load()
  }, [load])

  if (!state?.isRgss) return null

  const showTranslated = state.view === 'translated'

  return (
    <Switch
      label={showTranslated ? t('translate.rgssPreviewTranslated') : t('translate.rgssPreviewOriginal')}
      description={showTranslated ? t('translate.rgssPreviewTranslatedDesc') : t('translate.rgssPreviewOriginalDesc')}
      checked={showTranslated}
      disabled={pending}
      onCheckedChange={(checked) => {
        void (async () => {
          const view: RgssPreviewView = checked ? 'translated' : 'original'
          setPending(true)
          try {
            const res = await translationFetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'rgss-preview', view, contentRoot: state.contentRoot }),
            })
            const data = (await res.json()) as PreviewState & { error?: unknown }
            if (!res.ok) throw new Error(readApiErrorMessage(data))
            setState({
              view: data.view === 'original' ? 'original' : 'translated',
              isRgss: true,
              contentRoot: data.contentRoot || state.contentRoot,
            })
            notify.info(view === 'original' ? t('translate.rgssPreviewSwitchedOriginal') : t('translate.rgssPreviewSwitchedTranslated'))
          } catch (err) {
            notify.error(err instanceof Error ? err.message : t('notify.saveFailed'))
          } finally {
            setPending(false)
          }
        })()
      }}
    />
  )
}
