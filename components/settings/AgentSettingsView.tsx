'use client'

import { useCallback, useEffect, useState } from 'react'
import { IoAdd, IoArrowBack, IoCreateOutline, IoTrashOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, formControlInline, formDescInline, formFieldInline, formTitleInline, panelHead } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, EmptyState, NumberSliderInput, Select, Spinner, TextInput } from '@/components/sk'
import type { AgentSyncDocument } from '@/lib/game-agent/settings-sync'

import { type AgentModel, type AgentProfile, type AgentSettings, type AgentSettingsRequest, createAgentProfile } from './agent-types'

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
  const [busy, setBusy] = useState<'load' | 'test' | 'save' | 'delete' | ''>('load')
  const [loadError, setLoadError] = useState('')
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
        const body = (await response.json().catch(() => null)) as { settings?: AgentSettings; sync?: AgentSyncDocument }
        if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
        setSettings(body.settings)
        setBaseSync(body.sync || null)
        if (creating) setDraft(createAgentProfile())
        else if (agentId) {
          const profile = body.settings.profiles.find((item) => item.id === agentId)
          if (!profile) {
            setDraft(null)
            onNavigate()
            return
          }
          setDraft({ ...profile })
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

  const test = async () => {
    if (!draft) return
    setBusy('test')
    try {
      const response = await request(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', profile: draft }),
      })
      const body = (await response.json().catch(() => null)) as { models?: AgentModel[]; defaultModel?: string }
      if (!response.ok) throw new Error(apiError(body, `HTTP ${response.status}`))
      setModels(body.models || [])
      if (!draft.defaultModel && body.defaultModel) setDraft({ ...draft, defaultModel: body.defaultModel })
      notify.success(`${t('integration.agentConnected')} · ${(body.models || []).length}`)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!settings || !draft || creating || settings.profiles.length <= 1) return
    const ok = await confirm({
      title: t('integration.agentDeleteTitle'),
      description: t('integration.agentDeleteDescription', { name: draft.label }),
      confirmLabel: t('integration.agentDelete'),
      confirmVariant: 'fail',
    })
    if (!ok) return
    setBusy('delete')
    try {
      await saveSettings({ ...settings, profiles: settings.profiles.filter((item) => item.id !== draft.id) })
      onSaved?.()
      onNavigate()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
      setBusy('')
    }
  }

  const modelNames = new Set(models.map((item) => item.name))
  if (draft?.defaultModel) modelNames.add(draft.defaultModel)
  const modelOptions = [...modelNames].map((name) => ({ value: name, label: name }))

  if (busy === 'load')
    return (
      <div className="grid min-h-48 flex-1 place-items-center">
        <Spinner />
      </div>
    )
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
                    <p className="m-0 truncate text-sm font-medium text-ink">{profile.label}</p>
                    <p className="mt-1 mb-0 truncate text-xs text-ink-soft">
                      {profile.provider} · {profile.defaultModel || t('integration.agentNoModels')} · {profile.endpoint}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={t('integration.agentEdit')} onClick={() => onNavigate(profile.id)}>
                    <IoCreateOutline size={16} />
                  </Button>
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={panelHead}>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-ink">{creating ? t('integration.agentCreateTitle') : t('integration.agentEditTitle')}</strong>
          <span className="block truncate text-xs text-ink-soft">{t('integration.agentDetailHint')}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <section className={formCard}>
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
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentDefaultModel')}</span>
              <span className={formDescInline}>{t('integration.agentDefaultModelDesc')}</span>
              <div className={formControlInline}>
                <Select
                  className="w-full"
                  value={draft.defaultModel}
                  options={modelOptions}
                  placeholder={t('integration.agentNoModels')}
                  onChange={(defaultModel) => update({ defaultModel })}
                />
              </div>
            </label>
            <div className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentTest')}</span>
              <span className={formDescInline}>{t('integration.agentTestDesc')}</span>
              <div className={formControlInline}>
                <Button loading={busy === 'test'} onClick={() => void test()}>
                  {t('integration.agentTest')}
                </Button>
              </div>
            </div>
          </section>
          <section className={formCard}>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentTemperature')}</span>
              <span className={formDescInline}>{t('integration.agentTemperatureDesc')}</span>
              <div className={formControlInline}>
                <NumberSliderInput value={draft.temperature} min={0} max={2} step={0.1} allowDecimal onValueChange={(temperature) => update({ temperature })} />
              </div>
            </label>
            <label className={formFieldInline}>
              <span className={formTitleInline}>{t('integration.agentKeepAlive')}</span>
              <span className={formDescInline}>{t('integration.agentKeepAliveDesc')}</span>
              <div className={formControlInline}>
                <TextInput className="w-full" value={draft.keepAlive} onChange={(event) => update({ keepAlive: event.target.value })} />
              </div>
            </label>
            <div className="flex min-w-0 items-center justify-between gap-3" data-agent-detail-toolbar>
              <div className="flex min-w-0 items-center justify-start gap-2">
                <Button variant="ghost" onClick={() => onNavigate()}>
                  <IoArrowBack size={15} />
                  {t('integration.agentBack')}
                </Button>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-2">
                {!creating ? (
                  <Button variant="fail" disabled={settings.profiles.length <= 1} loading={busy === 'delete'} onClick={() => void remove()}>
                    <IoTrashOutline size={15} />
                    {t('integration.agentDelete')}
                  </Button>
                ) : null}
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
