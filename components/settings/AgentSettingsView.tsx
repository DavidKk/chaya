'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IoAdd, IoArrowBack, IoInfinite, IoTrashOutline } from 'react-icons/io5'
import { TbPencilCog } from 'react-icons/tb'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { lockIconBtn } from '@/components/game-edit/lock-ui'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, formControlInline, formDescInline, formFieldInline, formTitleInline, panelHead, settingsCardWide } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, DurationInput, EmptyState, NumberSliderInput, Select, TextInput, Tooltip, TruncateText } from '@/components/sk'
import { keepAliveToMs, msToKeepAlive } from '@/lib/game-agent/keep-alive'
import type { AgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { cn } from '@/lib/utils'

import { type AgentModel, type AgentProfile, type AgentSettings, type AgentSettingsRequest, createAgentProfile } from './agent-types'
import { AgentDetailSkeleton, AgentListSkeleton } from './AgentSettingsSkeleton'

const API = '/api/integration/game-agent'

function apiError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

type Props = {
  request: AgentSettingsRequest
  agentId?: string
  onNavigate: (agentId?: string) => void
  onSaved?: () => void
}

export function AgentSettingsView({ request, agentId, onNavigate, onSaved }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [baseSync, setBaseSync] = useState<AgentSyncDocument | null>(null)
  const [draft, setDraft] = useState<AgentProfile | null>(null)
  const [models, setModels] = useState<AgentModel[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [busy, setBusy] = useState<'load' | 'test' | 'save' | ''>('load')
  const [deletingId, setDeletingId] = useState('')
  const [loadError, setLoadError] = useState('')
  /** Last finite Keep Alive, restored when ∞ is switched off */
  const keepAliveFinite = useRef(600_000)
  const modelRequestId = useRef(0)
  const autoModelsTimer = useRef<number | undefined>(undefined)
  const draftRef = useRef<AgentProfile | null>(null)
  draftRef.current = draft
  const editing = agentId != null
  const creating = agentId === 'new'

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setBusy('load')
        setLoadError('')
      }
      try {
        const response = await request(API, { cache: 'no-store' })
        const body = (await response.json().catch(() => null)) as { settings?: AgentSettings; sync?: AgentSyncDocument; models?: Record<string, AgentModel[]> }
        if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
        setSettings(body.settings)
        setBaseSync(body.sync || null)
        if (creating) {
          setDraft(createAgentProfile())
          setModels([])
        } else if (agentId) {
          const profile = body.settings.profiles.find((item) => item.id === agentId)
          if (!profile) {
            setDraft(null)
            onNavigate()
            return
          }
          setDraft({ ...profile })
          setModels(body.models?.[profile.id] || [])
        } else setDraft(null)
      } catch (error) {
        if (!silent) {
          setLoadError(error instanceof Error ? error.message : String(error))
          setSettings(null)
        }
      } finally {
        if (!silent) setBusy('')
      }
    },
    [agentId, creating, onNavigate, request]
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (editing) return
    const refresh = () => void load(true)
    const interval = window.setInterval(refresh, 5_000)
    window.addEventListener('chaya:agent-settings-synced', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('chaya:agent-settings-synced', refresh)
    }
  }, [editing, load])

  const saveSettings = async (next: AgentSettings) => {
    const response = await request(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next, ...(baseSync ? { baseSync } : {}) }),
    })
    const body = (await response.json().catch(() => null)) as { settings?: AgentSettings; sync?: AgentSyncDocument }
    if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
    setSettings(body.settings)
    setBaseSync(body.sync || null)
    return body.settings
  }

  const save = async () => {
    if (!settings || !draft || !draft.label.trim()) return
    setBusy('save')
    try {
      const profiles = creating ? [...settings.profiles, draft] : settings.profiles.map((item) => (item.id === draft.id ? draft : item))
      const saved = await saveSettings({ ...settings, profiles })
      setDraft({ ...(saved.profiles.find((item) => item.id === draft.id) || draft) })
      notify.success(t('integration.agentSaved'))
      onSaved?.()
      if (creating) onNavigate(draft.id)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy('')
    }
  }

  const fetchModels = useCallback(
    async (profile: AgentProfile, feedback: 'none' | 'open' | 'test') => {
      const requestId = ++modelRequestId.current
      setModelsBusy(true)
      if (feedback === 'test') setBusy('test')
      try {
        const response = await request(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: feedback === 'test' ? 'test' : 'models', profile }),
        })
        const body = (await response.json().catch(() => null)) as { models?: AgentModel[]; defaultModel?: string }
        if (!response.ok) throw new Error(apiError(body, `HTTP ${response.status}`))
        if (requestId !== modelRequestId.current) return
        const nextModels = body.models || []
        setModels(nextModels)
        setDraft((current) => {
          if (!current || current.id !== profile.id || current.endpoint !== profile.endpoint) return current
          const selectedStillExists = nextModels.some((model) => model.name === current.defaultModel)
          return selectedStillExists || !body.defaultModel ? current : { ...current, defaultModel: body.defaultModel }
        })
        if (feedback === 'test') notify.success(t('integration.agentConnected'))
      } catch (error) {
        if (requestId === modelRequestId.current && feedback !== 'none') notify.error(error instanceof Error ? error.message : String(error))
      } finally {
        if (requestId === modelRequestId.current) setModelsBusy(false)
        if (feedback === 'test') setBusy('')
      }
    },
    [notify, request, t]
  )

  useEffect(() => {
    const profile = draftRef.current
    if (!profile?.endpoint.trim()) return
    autoModelsTimer.current = window.setTimeout(() => {
      autoModelsTimer.current = undefined
      void fetchModels(profile, 'none')
    }, 500)
    return () => {
      if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
      autoModelsTimer.current = undefined
    }
  }, [draft?.endpoint, draft?.id, fetchModels])

  const test = async () => {
    if (!draft) return
    if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
    autoModelsTimer.current = undefined
    await fetchModels({ ...draft }, 'test')
  }

  const loadModelsOnOpen = () => {
    if (!draft?.endpoint.trim() || modelsBusy) return
    if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
    autoModelsTimer.current = undefined
    void fetchModels({ ...draft }, 'open')
  }

  const removeProfile = async (profile: AgentProfile, navigateAfter = false) => {
    if (!settings || settings.profiles.length <= 1 || deletingId) return
    const ok = await confirm({
      title: t('integration.agentDeleteTitle'),
      description: t('integration.agentDeleteDescription', { name: profile.label }),
      confirmLabel: t('integration.agentDelete'),
      confirmVariant: 'fail',
    })
    if (!ok) return
    setDeletingId(profile.id)
    try {
      await saveSettings({ ...settings, profiles: settings.profiles.filter((item) => item.id !== profile.id) })
      onSaved?.()
      if (navigateAfter) onNavigate()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingId('')
    }
  }

  const modelNames = new Set(models.map((item) => item.name))
  if (draft?.defaultModel) modelNames.add(draft.defaultModel)
  const modelOptions = [...modelNames].map((name) => ({ value: name, label: name }))

  if (busy === 'load') return editing ? <AgentDetailSkeleton label={t('integration.agentEditTitle')} /> : <AgentListSkeleton label={t('integration.agentProfiles')} />
  if (!settings)
    return (
      <EmptyState title={t('integration.agentSettingsFailed')} message={loadError}>
        <Button className="mt-3" onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      </EmptyState>
    )

  if (!editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="w-full max-w-3xl overflow-hidden rounded-md border border-line bg-panel" data-agent-list-card>
            <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <strong className="block text-sm text-ink">{t('integration.agentProfiles')}</strong>
                <span className="mt-1 block text-xs leading-[1.35] text-ink-soft">{t('integration.agentProfilesHint')}</span>
              </div>
              <Button className="shrink-0" variant="accent" onClick={() => onNavigate('new')}>
                <IoAdd size={16} />
                {t('integration.agentAddProfile')}
              </Button>
            </div>
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {settings.profiles.map((profile) => (
                <li key={profile.id} className="flex items-center gap-3 px-3 py-3 hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]">
                  <div className="min-w-0 flex-1">
                    <TruncateText text={profile.label} className="block text-sm font-medium text-ink" />
                    <TruncateText
                      text={`${profile.provider} · ${profile.defaultModel || t('integration.agentNoModels')} · ${profile.endpoint}`}
                      className="mt-1 block text-xs text-ink-soft"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-px">
                    <Button variant="plain" size="icon" aria-label={t('integration.agentEdit')} onClick={() => onNavigate(profile.id)}>
                      <TbPencilCog size={16} aria-hidden />
                    </Button>
                    <Button
                      variant="plain"
                      size="icon"
                      className="text-fail"
                      aria-label={t('integration.agentDelete')}
                      disabled={settings.profiles.length <= 1 || Boolean(deletingId)}
                      loading={deletingId === profile.id}
                      onClick={() => void removeProfile(profile)}
                    >
                      <IoTrashOutline size={16} aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    )
  }

  if (!draft)
    return (
      <EmptyState title={t('integration.agentNotFound')}>
        <Button className="mt-3" onClick={() => onNavigate()}>
          {t('integration.agentBack')}
        </Button>
      </EmptyState>
    )

  const update = (patch: Partial<AgentProfile>) => {
    setDraft({ ...draft, ...patch })
  }

  const keepAliveMs = keepAliveToMs(draft.keepAlive)
  const keepAliveForever = keepAliveMs < 0
  if (!keepAliveForever) keepAliveFinite.current = keepAliveMs

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={panelHead}>
        <div className="min-w-0 flex-1">
          <TruncateText text={creating ? t('integration.agentCreateTitle') : t('integration.agentEditTitle')} className="block text-sm font-bold text-ink" />
          <TruncateText text={t('integration.agentDetailHint')} className="block text-xs text-ink-soft" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={settingsCardWide}>
          <section className={formCard} data-agent-detail-card>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentProfileLabel')}</span>
              <div className={formControlInline}>
                <TextInput className="w-full" value={draft.label} onChange={(event) => update({ label: event.target.value })} />
              </div>
            </label>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentProvider')}</span>
              <span className={formDescInline}>{t('integration.agentProviderDesc')}</span>
              <div className={formControlInline}>
                <Select className="w-full" value={draft.provider} options={[{ value: 'ollama', label: 'Ollama' }]} onChange={() => {}} />
              </div>
            </label>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentEndpoint')}</span>
              <span className={formDescInline}>{t('integration.agentEndpointDesc')}</span>
              <div className={formControlInline}>
                <TextInput className="w-full" value={draft.endpoint} onChange={(event) => update({ endpoint: event.target.value })} />
              </div>
            </label>
            <div className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentDefaultModel')}</span>
              <span className={formDescInline}>{t('integration.agentDefaultModelDesc')}</span>
              <div className={formControlInline}>
                <Select
                  className="w-full"
                  value={draft.defaultModel}
                  options={modelOptions}
                  placeholder={t('integration.agentNoModels')}
                  loading={modelsBusy}
                  onOpen={loadModelsOnOpen}
                  onChange={(defaultModel) => update({ defaultModel })}
                />
              </div>
            </div>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentTemperature')}</span>
              <span className={formDescInline}>{t('integration.agentTemperatureDesc')}</span>
              <div className={formControlInline}>
                <NumberSliderInput className="w-full" value={draft.temperature} min={0} max={2} step={0.1} allowDecimal onValueChange={(temperature) => update({ temperature })} />
              </div>
            </label>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentKeepAlive')}</span>
              <span className={formDescInline}>{t('integration.agentKeepAliveDesc')}</span>
              <div className={formControlInline}>
                <DurationInput
                  className="w-full"
                  value={keepAliveForever ? keepAliveFinite.current : keepAliveMs}
                  min={0}
                  disabled={keepAliveForever}
                  label={keepAliveForever ? t('integration.agentKeepAliveForever') : undefined}
                  zeroLabel={t('integration.agentKeepAliveUnload')}
                  endAction={
                    <Tooltip content={t(keepAliveForever ? 'integration.agentKeepAliveForeverOff' : 'integration.agentKeepAliveForeverOn')}>
                      <button
                        type="button"
                        className={cn(
                          lockIconBtn,
                          keepAliveForever && 'text-accent hover:enabled:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:enabled:text-accent'
                        )}
                        aria-label={t(keepAliveForever ? 'integration.agentKeepAliveForeverOff' : 'integration.agentKeepAliveForeverOn')}
                        aria-pressed={keepAliveForever}
                        onClick={() => update({ keepAlive: keepAliveForever ? msToKeepAlive(keepAliveFinite.current) : '-1' })}
                      >
                        <IoInfinite size={16} aria-hidden />
                      </button>
                    </Tooltip>
                  }
                  onValueChange={(ms) => update({ keepAlive: msToKeepAlive(ms) })}
                />
              </div>
            </label>
            <div className="flex min-w-0 items-center justify-between gap-3" data-agent-detail-toolbar>
              <div className="flex min-w-0 items-center justify-start gap-2">
                <Button variant="ghost" onClick={() => onNavigate()}>
                  <IoArrowBack size={15} />
                  {t('integration.agentBack')}
                </Button>
                {!creating ? (
                  <Button
                    variant="fail"
                    disabled={settings.profiles.length <= 1 || Boolean(deletingId)}
                    loading={deletingId === draft.id}
                    onClick={() => void removeProfile(draft, true)}
                  >
                    <IoTrashOutline size={15} />
                    {t('integration.agentDelete')}
                  </Button>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center justify-end gap-2">
                <Button loading={busy === 'test'} onClick={() => void test()}>
                  {t('integration.agentTest')}
                </Button>
                <Button variant="accent" disabled={!draft.label.trim()} loading={busy === 'save'} onClick={() => void save()}>
                  {t('integration.agentSave')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
