'use client'

import { useEffect, useState } from 'react'
import { IoAdd, IoArrowBack, IoCheckmark, IoTrashOutline } from 'react-icons/io5'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, NumberSliderInput, Select, Spinner, TextInput } from '@/components/sk'

type Profile = {
  id: string
  label: string
  provider: 'ollama'
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}
type Settings = { version: 1; defaultProfileId: string; profiles: Profile[] }
type Model = { name: string }
type Props = {
  request: (path: string, init?: RequestInit) => Promise<Response>
  onBack: () => void
  onSaved: () => void
}

const API = '/api/integration/game-agent'

function apiError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

function createProfile(): Profile {
  return {
    id: `ollama-${Date.now().toString(36)}`,
    label: 'Ollama',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: '',
    temperature: 0.2,
    keepAlive: '10m',
  }
}

export function GameAgentSettingsPanel({ request, onBack, onSaved }: Props) {
  const t = useT()
  const locale = useLocaleCode()
  const back = locale === 'zh' ? '返回对话' : locale === 'ja' ? '会話に戻る' : locale === 'ko' ? '대화로 돌아가기' : 'Back to chat'
  const [settings, setSettings] = useState<Settings | null>(null)
  const [profileId, setProfileId] = useState('')
  const [models, setModels] = useState<Record<string, Model[]>>({})
  const [busy, setBusy] = useState<'load' | 'test' | 'save' | ''>('load')
  const [message, setMessage] = useState('')
  const profile = settings?.profiles.find((item) => item.id === profileId) || null

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await request(API, { cache: 'no-store', signal: controller.signal })
        const body = (await response.json().catch(() => null)) as { settings?: Settings }
        if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
        setSettings(body.settings)
        setProfileId(body.settings.defaultProfileId || body.settings.profiles[0]?.id || '')
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error))
      } finally {
        if (!controller.signal.aborted) setBusy('')
      }
    })()
    return () => controller.abort()
  }, [request])

  const update = (patch: Partial<Profile>) => {
    if (!settings || !profile) return
    setSettings({ ...settings, profiles: settings.profiles.map((item) => (item.id === profile.id ? { ...item, ...patch } : item)) })
    setMessage('')
  }

  const test = async () => {
    if (!profile) return
    setBusy('test')
    setMessage('')
    try {
      const response = await request(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', profile }),
      })
      const body = (await response.json().catch(() => null)) as { models?: Model[]; defaultModel?: string }
      if (!response.ok) throw new Error(apiError(body, `HTTP ${response.status}`))
      const nextModels = body.models || []
      setModels((current) => ({ ...current, [profile.id]: nextModels }))
      if (!profile.defaultModel && body.defaultModel) update({ defaultModel: body.defaultModel })
      setMessage(`${t('integration.agentConnected')} · ${nextModels.length}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    if (!settings) return
    setBusy('save')
    setMessage('')
    try {
      const response = await request(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const body = (await response.json().catch(() => null)) as { settings?: Settings }
      if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
      setSettings(body.settings)
      setMessage(t('integration.agentSaved'))
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy('')
    }
  }

  if (busy === 'load')
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner />
      </div>
    )
  if (!settings || !profile)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-sm text-fail">{message || t('integration.agentSettingsFailed')}</p>
        <Button onClick={onBack}>{back}</Button>
      </div>
    )

  const add = () => {
    const next = createProfile()
    setSettings({ ...settings, profiles: [...settings.profiles, next] })
    setProfileId(next.id)
    setMessage('')
  }
  const remove = () => {
    if (settings.profiles.length === 1) return
    const profiles = settings.profiles.filter((item) => item.id !== profile.id)
    setSettings({ ...settings, profiles, defaultProfileId: settings.defaultProfileId === profile.id ? profiles[0].id : settings.defaultProfileId })
    setProfileId(profiles[0].id)
    setMessage('')
  }
  const options = models[profile.id]?.map((item) => ({ value: item.name, label: item.name })) || []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
        <Button variant="ghost" size="icon" aria-label={back} tooltip={back} onClick={onBack}>
          <IoArrowBack size={17} />
        </Button>
        <strong className="text-sm text-ink">{t('integration.regionAgent')}</strong>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" aria-label={t('integration.agentAddProfile')} tooltip={t('integration.agentAddProfile')} onClick={add}>
          <IoAdd size={18} />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentProfiles')}
            <Select value={profileId} options={settings.profiles.map((item) => ({ value: item.id, label: `${item.label} · ${item.provider}` }))} onChange={setProfileId} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentProfileLabel')}
            <TextInput value={profile.label} onChange={(event) => update({ label: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentProvider')}
            <Select value={profile.provider} options={[{ value: 'ollama', label: 'Ollama' }]} onChange={() => {}} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentEndpoint')}
            <TextInput value={profile.endpoint} onChange={(event) => update({ endpoint: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentDefaultModel')}
            {options.length ? (
              <Select value={profile.defaultModel} options={options} onChange={(defaultModel) => update({ defaultModel })} />
            ) : (
              <TextInput value={profile.defaultModel} placeholder={t('integration.agentNoModels')} onChange={(event) => update({ defaultModel: event.target.value })} />
            )}
          </label>
          <Button loading={busy === 'test'} onClick={() => void test()}>
            {t('integration.agentTest')}
          </Button>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentTemperature')}
            <NumberSliderInput value={profile.temperature} min={0} max={2} step={0.1} allowDecimal onValueChange={(temperature) => update({ temperature })} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-soft">
            {t('integration.agentKeepAlive')}
            <TextInput value={profile.keepAlive} onChange={(event) => update({ keepAlive: event.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={settings.defaultProfileId === profile.id ? 'ok' : 'default'}
              disabled={settings.defaultProfileId === profile.id}
              onClick={() => setSettings({ ...settings, defaultProfileId: profile.id })}
            >
              {settings.defaultProfileId === profile.id ? (
                <>
                  <IoCheckmark size={15} />
                  {t('integration.agentDefault')}
                </>
              ) : (
                t('integration.agentSetDefault')
              )}
            </Button>
            <Button variant="ghost" disabled={settings.profiles.length === 1} onClick={remove}>
              <IoTrashOutline size={15} />
              {t('integration.agentDelete')}
            </Button>
          </div>
          {message ? <p className={message.includes('·') || message === t('integration.agentSaved') ? 'm-0 text-xs text-ok' : 'm-0 text-xs text-fail'}>{message}</p> : null}
        </div>
      </div>
      <footer className="shrink-0 border-t border-line bg-panel-2 p-3">
        <Button className="w-full" variant="accent" loading={busy === 'save'} onClick={() => void save()}>
          {t('integration.agentSave')}
        </Button>
      </footer>
    </div>
  )
}
