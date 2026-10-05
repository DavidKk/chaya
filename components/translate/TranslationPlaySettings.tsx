'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formControlInline, formDescInline, formFieldInlineDense, formTitleInline } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, DurationInput, Skeleton, Switch } from '@/components/sk'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { DEFAULT_PLAY_SETTINGS, type TranslationPlaySettings as Settings } from '@/lib/translate/play-settings'
import { cn } from '@/lib/utils'

export function TranslationPlaySettings() {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const [draft, setDraft] = useState<Settings>(DEFAULT_PLAY_SETTINGS)
  const [saved, setSaved] = useState<Settings | null>(null)
  const [contentRoot, setContentRoot] = useState('')
  const [pending, setPending] = useState<'load' | 'save' | 'test' | null>('load')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const current = useRef<AbortController | null>(null)
  const saving = useRef(false)
  const timeoutSave = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    current.current?.abort()
    const abort = new AbortController()
    current.current = abort
    saving.current = false
    setPending('load')
    setSaved(null)
    setFeedback('')
    setError('')
    try {
      const response = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'play-settings' }),
        signal: abort.signal,
      })
      const data = (await response.json()) as { settings: Settings; contentRoot: string }
      if (!response.ok) throw new Error(readApiErrorMessage(data, t('translate.loadPlayFailed')))
      if (abort.signal.aborted) return
      setContentRoot(data.contentRoot)
      setSaved(data.settings)
      setDraft(data.settings)
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : t('notify.loadFailed'))
    } finally {
      if (!abort.signal.aborted) setPending(null)
    }
  }, [t, translationFetch])
  useEffect(() => {
    void load()
    return () => {
      current.current?.abort()
      if (timeoutSave.current) clearTimeout(timeoutSave.current)
    }
  }, [load])

  async function run(action: 'save' | 'test', next: Settings = draft) {
    if (pending || saving.current) return
    saving.current = true
    if (action === 'save') setDraft(next)
    current.current?.abort()
    const abort = new AbortController()
    current.current = abort
    setPending(action)
    setError('')
    setFeedback('')
    try {
      const response = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({ mode: action === 'save' ? 'play-settings' : 'benchmark', settings: next, contentRoot }),
      })
      const data = (await response.json()) as { settings: Settings; translation: string; characters: number; elapsedMs: number }
      if (!response.ok) throw new Error(readApiErrorMessage(data, action === 'save' ? t('notify.saveFailed') : t('translate.benchFailed')))
      if (abort.signal.aborted) return
      if (action === 'save') {
        setSaved(data.settings)
        setDraft(data.settings)
        setFeedback(t('translate.savedPlay'))
      } else notify.info(`${t('translate.benchLine', { chars: data.characters, sec: (data.elapsedMs / 1000).toFixed(2) })}：${data.translation}`)
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : t('translate.requestFailed')
        if (action === 'test') notify.error(t('translate.benchFailPrefix', { message }))
        else setError(t('translate.saveNotSaved', { message }))
      }
    } finally {
      if (current.current === abort) {
        saving.current = false
        if (!abort.signal.aborted) setPending(null)
      }
    }
  }

  const dirty = saved != null && JSON.stringify(draft) !== JSON.stringify(saved)
  const saveTimeout = (timeoutMs: number) => {
    if (!saved) return
    const next = { ...draft, timeoutMs }
    setDraft(next)
    if (timeoutSave.current) clearTimeout(timeoutSave.current)
    if (saved.timeoutMs === next.timeoutMs) return
    timeoutSave.current = setTimeout(() => {
      timeoutSave.current = null
      void run('save', next)
    }, 300)
  }
  return (
    <section className={cn(formCardDense, 'm-0 w-full')} aria-label={t('translate.playModeAria')} aria-busy={pending !== null}>
      {pending === 'load' && !saved ? (
        <div className="space-y-3" aria-label={t('translate.playLoadAria')}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : saved ? (
        <>
          <Switch
            label={t('translate.realtime')}
            description={t('translate.realtimeDesc')}
            checked={draft.mode === 'realtime'}
            disabled={!!pending}
            onCheckedChange={(checked) => void run('save', { ...draft, mode: checked ? 'realtime' : 'pretranslated' })}
          />
          <Switch
            label={t('translate.subtitle')}
            description={t('translate.subtitleDesc')}
            checked={draft.mode === 'subtitle'}
            disabled={!!pending}
            onCheckedChange={(checked) => void run('save', { ...draft, mode: checked ? 'subtitle' : 'pretranslated' })}
          />
          <div className={formFieldInlineDense}>
            <span className={formTitleInline}>{t('translate.timeout')}</span>
            <span id="translation-timeout-help" className={formDescInline}>
              {t('translate.timeoutHint')}
            </span>
            <div className={formControlInline}>
              <DurationInput
                id="translation-timeout"
                aria-describedby="translation-timeout-help"
                aria-label={t('translate.timeout')}
                className="w-full"
                min={2000}
                max={30_000}
                step={1000}
                disabled={!!pending}
                value={draft.timeoutMs}
                onValueChange={saveTimeout}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!!pending || dirty} loading={pending === 'test'} onClick={() => void run('test')}>
              {t('translate.testLocal')}
            </Button>
            {pending === 'save' || feedback ? (
              <span role="status" className="text-[0.7rem] text-ink-soft">
                {pending === 'save' ? t('translate.saving') : feedback}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
      {error ? (
        <div role="alert" className="text-sm text-fail">
          {error}
          {!saved || dirty ? (
            <Button className="ml-3" disabled={!!pending} onClick={() => (saved ? void run('save') : void load())}>
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
