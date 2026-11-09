'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoAdd, IoArrowBack, IoInfinite, IoOptionsOutline, IoTrashOutline } from 'react-icons/io5'
import { TbPencilCog } from 'react-icons/tb'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useUnsavedChanges } from '@/components/confirm/UnsavedChangesProvider'
import { lockIconBtn } from '@/components/game-edit/lock-ui'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import {
  formCard,
  formControlInlineStart,
  formDesc,
  formDescInline,
  formField,
  formFieldInlineWideLabel,
  formTitle,
  formTitleInline,
  panelHead,
  settingsCardWide,
} from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import {
  AffixedTextInput,
  ApiKeyInput,
  Button,
  Combobox,
  DurationInput,
  EmptyState,
  NumberSliderInput,
  PlainTextEditor,
  resolveApiKeySaveAction,
  Select,
  SwitchToggle,
  TextInput,
  Tooltip,
  TruncateText,
} from '@/components/sk'
import { ScrollArea } from '@/components/sk/ScrollArea'
import { keepAliveToMs, msToKeepAlive } from '@/lib/game-agent/keep-alive'
import { isModelEnabled } from '@/lib/game-agent/profile-models'
import {
  type AgentProviderAvailability,
  CLI_PROVIDERS_FEATURE,
  type CliAgentProvider,
  GAME_AGENT_PROVIDERS,
  type GameAgentProvider,
  isApiKeyProvider,
  isCliProvider,
  isOpenApiProvider,
  isRemoteAuthProvider,
  OPENAPI_PROVIDERS_FEATURE,
} from '@/lib/game-agent/providers'
import {
  AGENT_PROXY_PROTOCOL_FIELDS,
  type AgentProxyProtocol,
  type AgentProxyProtocolField,
  defaultAgentProxyUrlScheme,
  normalizeAgentProxy,
  normalizeAgentProxyHeaders,
  normalizeAgentProxyProtocols,
  resolveAgentProxySlots,
} from '@/lib/game-agent/proxy'
import { loadAiRoles, saveAiRole } from '@/lib/game-agent/roles'
import type { AgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { cn } from '@/lib/utils'

import { type AgentModel, type AgentProfile, type AgentSettings, type AgentSettingsRequest, createAgentProfile, proxyHeadersText, withAgentProvider } from './agent-types'
import { AgentAuthSection } from './AgentAuthSection'
import { AgentProxyUrlInput } from './AgentProxyUrlInput'
import { AgentDetailSkeleton, AgentListSkeleton } from './AgentSettingsSkeleton'

const API = '/api/integration/game-agent'
const AGENT_FEATURES = [CLI_PROVIDERS_FEATURE, OPENAPI_PROVIDERS_FEATURE]

const PROVIDER_LABEL_KEYS = {
  ollama: 'agentAuth.providerOllama',
  cursor: 'agentAuth.providerCursor',
  codex: 'agentAuth.providerCodex',
  claude: 'agentAuth.providerClaude',
  gemini: 'agentAuth.providerGemini',
  cc: 'agentAuth.providerCc',
  'codex-api': 'agentAuth.providerCodexApi',
  'gemini-api': 'agentAuth.providerGeminiApi',
} as const satisfies Record<GameAgentProvider, string>

type AgentProfileView = AgentProfile & { hasToken?: boolean }

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
  const locale = useLocaleCode()
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
  /** Write-only API key draft while unlocked; sealed fields never show the real secret. */
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [hasToken, setHasToken] = useState(false)
  /** After save, locked to a fixed mask until the user clicks to clear and re-enter. */
  const [apiKeyUnlocked, setApiKeyUnlocked] = useState(false)
  const [proxyHeadersDraft, setProxyHeadersDraft] = useState('')
  /** Expands per-protocol override rows under the default proxy field. */
  const [proxyProtocolsOpen, setProxyProtocolsOpen] = useState(false)
  /** Explicit inherit toggles; opening the panel defaults to editable (not inherit). */
  const [protocolInherit, setProtocolInherit] = useState<Partial<Record<AgentProxyProtocolField, boolean>>>({})
  /** CLI agent types need the local service; Cloud and browser runtimes answer LOCAL_ONLY. */
  const [cliAvailable, setCliAvailable] = useState(true)
  /** Types whose sign-in Chaya does not support yet, or whose CLI is not installed, cannot be picked. */
  const [providerAvailability, setProviderAvailability] = useState<Partial<Record<CliAgentProvider, AgentProviderAvailability>>>({})
  /** Last finite Keep Alive, restored when ∞ is switched off */
  const keepAliveFinite = useRef(600_000)
  const modelRequestId = useRef(0)
  const autoModelsTimer = useRef<number | undefined>(undefined)
  const draftRef = useRef<AgentProfile | null>(null)
  draftRef.current = draft
  const editing = agentId != null
  const creating = agentId === 'new'
  const saved = creating || !settings ? undefined : settings.profiles.find((item) => item.id === draft?.id)
  const isDirty = useMemo(() => {
    if (!draft) return false
    if (creating) {
      return Boolean(draft.label.trim() || apiKeyDraft.trim() || draft.endpoint || draft.proxy || proxyHeadersDraft.trim())
    }
    if (!saved) return false
    return (
      draft.label !== saved.label ||
      draft.provider !== saved.provider ||
      draft.defaultModel !== saved.defaultModel ||
      JSON.stringify(draft.enabledModels ?? null) !== JSON.stringify(saved.enabledModels ?? null) ||
      draft.endpoint !== saved.endpoint ||
      (draft.modelsEndpoint || '') !== (saved.modelsEndpoint || '') ||
      (draft.proxy || '') !== (saved.proxy || '') ||
      JSON.stringify(draft.proxyProtocols || {}) !== JSON.stringify(saved.proxyProtocols || {}) ||
      proxyHeadersText(saved.proxyHeaders) !== proxyHeadersDraft ||
      draft.keepAlive !== saved.keepAlive ||
      Boolean(apiKeyDraft.trim())
    )
  }, [creating, draft, saved, apiKeyDraft, proxyHeadersDraft])

  const { confirmIfDirty } = useUnsavedChanges(Boolean(editing && isDirty))

  const handleNavigate = useCallback(
    async (targetId?: string) => {
      if (await confirmIfDirty()) {
        onNavigate(targetId)
      }
    },
    [confirmIfDirty, onNavigate]
  )

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setBusy('load')
        setLoadError('')
      }
      try {
        const response = await request(API, { cache: 'no-store' })
        const body = (await response.json().catch(() => null)) as {
          settings?: AgentSettings & { profiles: AgentProfileView[] }
          sync?: AgentSyncDocument
          models?: Record<string, AgentModel[]>
        }
        if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
        setSettings(body.settings)
        setBaseSync(body.sync || null)
        if (creating) {
          const next = createAgentProfile()
          setDraft(next)
          setApiKeyDraft('')
          setHasToken(false)
          setApiKeyUnlocked(false)
          setProxyHeadersDraft('')
          setProxyProtocolsOpen(false)
          setProtocolInherit({})
          setModels([])
        } else if (agentId) {
          const profile = body.settings.profiles.find((item) => item.id === agentId)
          if (!profile) {
            setDraft(null)
            onNavigate()
            return
          }
          setDraft({
            ...profile,
            modelsEndpoint: profile.modelsEndpoint || '',
            proxy: profile.proxy || '',
            proxyProtocols: profile.proxyProtocols || {},
            proxyHeaders: profile.proxyHeaders || {},
          })
          setApiKeyDraft('')
          setHasToken(Boolean(profile.hasToken))
          setApiKeyUnlocked(false)
          setProxyHeadersDraft(proxyHeadersText(profile.proxyHeaders))
          setProxyProtocolsOpen(Boolean(profile.proxyProtocols && Object.keys(profile.proxyProtocols).length))
          setProtocolInherit({})
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
    let active = true
    void request('/api/game-agent/auth?profileId=', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string }
          providers?: Partial<Record<CliAgentProvider, AgentProviderAvailability>>
        } | null
        if (!active) return
        setCliAvailable(body?.error?.code !== 'LOCAL_ONLY')
        if (response.ok && body?.providers) setProviderAvailability(body.providers)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [request])

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
      body: JSON.stringify({ settings: next, features: AGENT_FEATURES, ...(baseSync ? { baseSync } : {}) }),
    })
    const body = (await response.json().catch(() => null)) as { settings?: AgentSettings & { profiles: AgentProfileView[] }; sync?: AgentSyncDocument }
    if (!response.ok || !body.settings) throw new Error(apiError(body, `HTTP ${response.status}`))
    setSettings(body.settings)
    setBaseSync(body.sync || null)
    return body.settings
  }

  const save = async () => {
    if (!settings || !draft || !draft.label.trim()) return
    const previous = creating ? undefined : settings.profiles.find((item) => item.id === draft.id)
    if (previous && previous.provider !== draft.provider && isRemoteAuthProvider(previous.provider)) {
      const ok = await confirm({
        title: t('agentAuth.typeChangeTitle'),
        description: t('agentAuth.typeChangeDescription'),
        confirmLabel: t('agentAuth.typeChangeConfirm'),
        confirmVariant: 'fail',
      })
      if (!ok) return
    }
    let proxyHeaders: Record<string, string>
    let proxyProtocols: AgentProfile['proxyProtocols']
    try {
      proxyHeaders = normalizeAgentProxyHeaders(proxyHeadersDraft)
      proxyProtocols = normalizeAgentProxyProtocols(draft.proxy, draft.proxyProtocols)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
      return
    }
    setBusy('save')
    try {
      const nextDraft = {
        ...draft,
        modelsEndpoint: (draft.modelsEndpoint || '').trim(),
        proxyHeaders,
        proxyProtocols,
      }
      const profiles = creating ? [...settings.profiles, nextDraft] : settings.profiles.map((item) => (item.id === draft.id ? nextDraft : item))
      const saved = await saveSettings({ ...settings, profiles })
      const savedProfile = (saved.profiles.find((item) => item.id === draft.id) || nextDraft) as AgentProfileView
      let tokenPresent = Boolean(savedProfile.hasToken)
      if (isApiKeyProvider(nextDraft.provider)) {
        const action = resolveApiKeySaveAction({ unlocked: apiKeyUnlocked, value: apiKeyDraft })
        if (action.kind !== 'keep') {
          const tokenResponse = await request(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              action.kind === 'set' ? { action: 'token', profileId: nextDraft.id, token: action.token } : { action: 'token', profileId: nextDraft.id, clearToken: true }
            ),
          })
          const tokenBody = (await tokenResponse.json().catch(() => null)) as { hasToken?: boolean }
          if (!tokenResponse.ok) throw new Error(apiError(tokenBody, `HTTP ${tokenResponse.status}`))
          tokenPresent = action.kind === 'set' ? true : Boolean(tokenBody.hasToken)
        }
      }
      setApiKeyDraft('')
      setApiKeyUnlocked(false)
      setHasToken(tokenPresent)
      setDraft({ ...savedProfile, proxyHeaders: savedProfile.proxyHeaders || {}, hasToken: tokenPresent })
      setProxyHeadersDraft(proxyHeadersText(savedProfile.proxyHeaders))
      setProxyProtocolsOpen(Boolean(savedProfile.proxyProtocols && Object.keys(savedProfile.proxyProtocols).length))
      setProtocolInherit({})
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
          body: JSON.stringify({
            action: feedback === 'test' ? 'test' : 'models',
            profile,
            token: apiKeyDraft.trim() || undefined,
          }),
        })
        const body = (await response.json().catch(() => null)) as { models?: AgentModel[]; defaultModel?: string; model?: string; latencyMs?: number }
        if (!response.ok) throw new Error(apiError(body, `HTTP ${response.status}`))
        if (requestId !== modelRequestId.current) return
        const nextModels = body.models || []
        setModels(nextModels)
        setDraft((current) => {
          if (!current || current.id !== profile.id || current.endpoint !== profile.endpoint) return current
          const selectedStillExists = nextModels.some((model) => model.name === current.defaultModel)
          const defaultModel = selectedStillExists || !body.defaultModel ? current.defaultModel : body.defaultModel
          if (current.enabledModels?.length) {
            const known = new Set(nextModels.map((model) => model.name))
            // Keep the user's allowlist; drop ids that disappeared from the catalog.
            const pruned = current.enabledModels.filter((name) => known.has(name) || name === defaultModel)
            return { ...current, defaultModel, enabledModels: pruned.length ? pruned : current.enabledModels }
          }
          return { ...current, defaultModel }
        })
        if (feedback === 'test')
          notify.success(
            body.model && typeof body.latencyMs === 'number'
              ? t('agentAuth.testOk', { model: body.model === 'auto' ? t('agentAuth.defaultModelAuto') : body.model, seconds: (body.latencyMs / 1000).toFixed(1) })
              : t('integration.agentConnected')
          )
      } catch (error) {
        if (requestId === modelRequestId.current && feedback !== 'none') notify.error(error instanceof Error ? error.message : String(error))
      } finally {
        if (requestId === modelRequestId.current) setModelsBusy(false)
        if (feedback === 'test') setBusy('')
      }
    },
    [apiKeyDraft, notify, request, t]
  )

  useEffect(() => {
    const profile = draftRef.current
    if (!profile?.endpoint.trim() || isCliProvider(profile.provider)) return
    autoModelsTimer.current = window.setTimeout(() => {
      autoModelsTimer.current = undefined
      void fetchModels(profile, 'none')
    }, 500)
    return () => {
      if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
      autoModelsTimer.current = undefined
    }
  }, [draft?.endpoint, draft?.id, draft?.provider, fetchModels])

  const test = async () => {
    if (!draft) return
    if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
    autoModelsTimer.current = undefined
    await fetchModels({ ...draft }, 'test')
  }

  const loadModelsOnOpen = () => {
    if (!draft || modelsBusy || (!isCliProvider(draft.provider) && !draft.endpoint.trim())) return
    if (autoModelsTimer.current !== undefined) window.clearTimeout(autoModelsTimer.current)
    autoModelsTimer.current = undefined
    void fetchModels({ ...draft }, 'open')
  }

  const removeProfile = async (profile: AgentProfile, navigateAfter = false) => {
    if (!settings || settings.profiles.length <= 1 || deletingId) return
    const roles = loadAiRoles()
    const referencingRoles = roles.filter((r) => r.provider === profile.id || r.provider === profile.provider)

    let ok = false
    if (referencingRoles.length > 0) {
      const names = referencingRoles.map((r) => r.name).join('、')
      const phrase = `DELETE ${profile.label}`
      const isZh = locale.startsWith('zh') || locale === 'cht'
      ok = await confirm({
        title: isZh ? '危险操作：强制删除 Agent 实例' : 'Force Delete Agent Instance',
        description: isZh
          ? `该 Agent 实例正被旅伴「${names}」关联使用。删除后这些旅伴将无法正常运行！如确认删除，请在下方输入确认文字：`
          : `This agent instance is used by companion(s): "${names}". Deleting it will leave them unconfigured! Type the confirmation text below:`,
        challengePhrase: phrase,
        confirmLabel: isZh ? '强制删除' : 'Force Delete',
        confirmVariant: 'fail',
      })
    } else {
      ok = await confirm({
        title: t('integration.agentDeleteTitle'),
        description: t('integration.agentDeleteDescription', { name: profile.label }),
        confirmLabel: t('integration.agentDelete'),
        confirmVariant: 'fail',
      })
    }
    if (!ok) return
    setDeletingId(profile.id)
    try {
      await saveSettings({ ...settings, profiles: settings.profiles.filter((item) => item.id !== profile.id) })
      if (referencingRoles.length > 0) {
        for (const r of referencingRoles) {
          saveAiRole({ ...r, provider: '' as GameAgentProvider, model: '' })
        }
      }
      onSaved?.()
      if (navigateAfter) onNavigate()
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingId('')
    }
  }

  const providerLabel = (provider: GameAgentProvider) => t(PROVIDER_LABEL_KEYS[provider])
  const modelLabels = new Map(models.map((item) => [item.name, item.label || item.name]))
  if (draft?.defaultModel && !modelLabels.has(draft.defaultModel)) modelLabels.set(draft.defaultModel, draft.defaultModel)
  for (const name of draft?.enabledModels || []) {
    if (!modelLabels.has(name)) modelLabels.set(name, name)
  }
  const catalogNames = models.map((item) => item.name)
  const listedModelNames = [...catalogNames, ...[...modelLabels.keys()].filter((name) => !catalogNames.includes(name))]
  const enabledNames = draft ? (draft.enabledModels ? draft.enabledModels : catalogNames.length ? catalogNames : draft.defaultModel ? [draft.defaultModel] : []) : []
  const enabledCount = listedModelNames.filter((name) => isModelEnabled(name, draft?.enabledModels)).length
  const allEnabled = listedModelNames.length > 0 && enabledCount === listedModelNames.length
  const setEnabledNames = (next: string[] | undefined) => {
    if (!draft) return
    // Keep an explicit allowlist once the user toggles models; undefined only means "not customized yet".
    const enabledModels = next ? [...new Set(next.filter(Boolean))] : undefined
    const defaultModel = isModelEnabled(draft.defaultModel, enabledModels)
      ? draft.defaultModel
      : enabledModels?.[0] || (enabledModels === undefined ? catalogNames[0] || draft.defaultModel || '' : '')
    update({ enabledModels, defaultModel })
  }
  const modelOptions = [
    ...(draft && isCliProvider(draft.provider) ? [{ value: '', label: t('agentAuth.defaultModelAuto') }] : []),
    ...enabledNames.map((name) => ({ value: name, label: modelLabels.get(name) || name })),
  ]

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
        <div className={panelHead}>
          <div className="flex min-w-0 flex-col">
            <h2 className="m-0 text-sm font-semibold text-ink">AGENT</h2>
            <p className="m-0 truncate text-xs text-ink-soft">{locale.startsWith('zh') ? '管理全局 Agent 运行实例与后端驱动配置' : 'Manage global agent runtime profiles'}</p>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4" restorationKey={editing ? `agent:${agentId}` : 'agents'}>
          <div className={settingsCardWide}>
            <section className="w-full overflow-hidden rounded-md border border-line bg-panel" data-agent-list-card>
              <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm text-ink">{t('integration.agentProfiles')}</strong>
                  <span className="mt-1 block text-xs leading-[1.35] text-ink-soft">{t('integration.agentProfilesHint')}</span>
                </div>
                <Button className="shrink-0" variant="accent" onClick={() => void handleNavigate('new')}>
                  <IoAdd size={16} />
                  {t('integration.agentAddProfile')}
                </Button>
              </div>
              <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                {settings.profiles.map((profile) => (
                  <li
                    key={profile.id}
                    data-navigation-id={`agent:${profile.id}`}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
                  >
                    <div className="min-w-0 flex-1">
                      <TruncateText text={profile.label} className="block text-sm font-medium text-ink" />
                      <TruncateText
                        text={
                          isCliProvider(profile.provider)
                            ? `${providerLabel(profile.provider)} · ${profile.defaultModel.replace(/\[[^\]]*\]$/, '') || t('agentAuth.defaultModelAuto')}`
                            : `${providerLabel(profile.provider)} · ${profile.defaultModel || t('integration.agentNoModels')} · ${profile.endpoint}`
                        }
                        className="mt-1 block text-xs text-ink-soft"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-px">
                      <Button variant="plain" size="icon" aria-label={t('integration.agentEdit')} data-navigation-trigger="" onClick={() => void handleNavigate(profile.id)}>
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
        </ScrollArea>
      </div>
    )
  }

  if (!draft)
    return (
      <EmptyState title={t('integration.agentNotFound')}>
        <Button className="mt-3" onClick={() => void handleNavigate()}>
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
  const draftProvider = draft.provider
  const cli = isCliProvider(draftProvider)
  const openApi = isOpenApiProvider(draftProvider)
  const httpModel = draftProvider === 'ollama' || openApi
  const savedProvider = saved?.provider
  let draftProxy: string | null
  let draftProxySlots: ReturnType<typeof resolveAgentProxySlots> | null = null
  try {
    draftProxy = normalizeAgentProxy(draft.proxy)
    const overrides = normalizeAgentProxyProtocols(draft.proxy, draft.proxyProtocols)
    draftProxySlots = resolveAgentProxySlots(draft.proxy, overrides)
  } catch {
    draftProxy = null
  }
  let draftProxyHeaders: Record<string, string> | null
  try {
    draftProxyHeaders = normalizeAgentProxyHeaders(proxyHeadersDraft)
  } catch {
    draftProxyHeaders = null
  }
  const proxyInvalid = draftProxy === null || draftProxyHeaders === null

  const setProxyProtocol = (key: AgentProxyProtocol, value: string) => {
    const next = { ...(draft.proxyProtocols || {}) }
    if (!value.trim()) delete next[key]
    else next[key] = value
    update({ proxyProtocols: next })
  }
  const hasProxyOverrides = Boolean(draft.proxyProtocols && Object.keys(draft.proxyProtocols).length)
  const providerOptions = GAME_AGENT_PROVIDERS.map((value) => {
    const reason = !isCliProvider(value)
      ? null
      : !cliAvailable
        ? t('agentAuth.providerLocalOnly')
        : providerAvailability[value]?.reason === 'unsupported'
          ? t('agentAuth.providerUnsupported')
          : providerAvailability[value]?.reason === 'cli_missing'
            ? t('agentAuth.providerCliMissing')
            : null
    return { value, label: reason ? `${providerLabel(value)} · ${reason}` : providerLabel(value), disabled: Boolean(reason) && value !== draftProvider }
  })
  const changeProvider = (value: string) => {
    if (value === draftProvider || !GAME_AGENT_PROVIDERS.includes(value as GameAgentProvider)) return
    const next = value as GameAgentProvider
    setModels([])
    setApiKeyDraft('')
    setHasToken(false)
    setApiKeyUnlocked(false)
    setDraft(withAgentProvider(draft, next, providerLabel(draftProvider), providerLabel(next)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={panelHead}>
        <div className="min-w-0 flex-1">
          <TruncateText text={creating ? t('integration.agentCreateTitle') : t('integration.agentEditTitle')} className="block text-sm font-bold text-ink" />
          <TruncateText text={t('integration.agentDetailHint')} className="block text-xs text-ink-soft" />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4" restorationKey={editing ? `agent:${agentId}` : 'agents'}>
        <div className={settingsCardWide}>
          <section className={formCard} data-agent-detail-card>
            <label className={formFieldInlineWideLabel}>
              <span className={formTitleInline}>{t('integration.agentProvider')}</span>
              <span className={formDescInline}>{t('integration.agentProviderDesc')}</span>
              <div className={formControlInlineStart}>
                <Select className="w-full" value={draftProvider} options={providerOptions} onChange={changeProvider} />
              </div>
            </label>
            <label className={formFieldInlineWideLabel}>
              <span className={formTitleInline}>{t('integration.agentProfileLabel')}</span>
              <span className={formDescInline}>{t('integration.agentProfileLabelDesc')}</span>
              <div className={formControlInlineStart}>
                <TextInput
                  className="w-full"
                  value={draft.label}
                  onChange={(event) => update({ label: event.target.value })}
                  onInput={(event) => update({ label: (event.target as HTMLInputElement).value })}
                />
              </div>
            </label>
            {cli && savedProvider === draftProvider ? (
              <AgentAuthSection
                request={request}
                profileId={draft.id}
                provider={draftProvider}
                name={draft.label}
                savedProxy={saved?.proxy || ''}
                proxyPending={
                  (saved?.proxy || '') !== (draftProxy ?? draft.proxy) ||
                  JSON.stringify(saved?.proxyProtocols || {}) !== JSON.stringify(draft.proxyProtocols || {}) ||
                  proxyHeadersText(saved?.proxyHeaders) !== proxyHeadersText(draftProxyHeaders || draft.proxyHeaders)
                }
              />
            ) : cli ? (
              <div className={formFieldInlineWideLabel}>
                <span className={formTitleInline}>{t('agentAuth.section')}</span>
                <span className={formDescInline}>{t('agentAuth.saveFirst')}</span>
              </div>
            ) : (
              <>
                <label className={formFieldInlineWideLabel}>
                  <span className={formTitleInline}>
                    {t(draftProvider === 'gemini-api' ? 'integration.agentGeminiEndpoint' : openApi ? 'integration.agentOpenApiEndpoint' : 'integration.agentEndpoint')}
                  </span>
                  <span className={formDescInline}>
                    {t(draftProvider === 'gemini-api' ? 'integration.agentGeminiEndpointDesc' : openApi ? 'integration.agentOpenApiEndpointDesc' : 'integration.agentEndpointDesc')}
                  </span>
                  <div className={formControlInlineStart}>
                    <TextInput className="w-full" value={draft.endpoint} onChange={(event) => update({ endpoint: event.target.value })} spellCheck={false} />
                  </div>
                </label>
                {openApi ? (
                  <label className={formFieldInlineWideLabel}>
                    <span className={formTitleInline}>{t('integration.agentModelsEndpoint')}</span>
                    <span className={formDescInline}>{t('integration.agentModelsEndpointDesc')}</span>
                    <div className={formControlInlineStart}>
                      <TextInput
                        className="w-full"
                        value={draft.modelsEndpoint || ''}
                        placeholder="/models 或 /codex/models"
                        onChange={(event) => update({ modelsEndpoint: event.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </label>
                ) : null}
                {isApiKeyProvider(draftProvider) ? (
                  <label className={formFieldInlineWideLabel}>
                    <span className={formTitleInline}>{t('integration.agentApiKey')}</span>
                    <span className={formDescInline}>
                      {hasToken && !apiKeyUnlocked
                        ? t('integration.agentApiKeyConfigured')
                        : t(draftProvider === 'gemini-api' ? 'integration.agentApiKeyGeminiDesc' : openApi ? 'integration.agentApiKeyDesc' : 'integration.agentApiKeyOllamaDesc')}
                    </span>
                    <div className={formControlInlineStart}>
                      <ApiKeyInput
                        configured={hasToken}
                        value={apiKeyDraft}
                        unlocked={apiKeyUnlocked}
                        onUnlockedChange={setApiKeyUnlocked}
                        onChange={setApiKeyDraft}
                        placeholder={t('integration.agentApiKeyPlaceholder')}
                        disabled={busy === 'save'}
                      />
                    </div>
                  </label>
                ) : null}
              </>
            )}
            {!isCliProvider(draft.provider) ? (
              <div className="relative !px-0 !py-0 before:!inset-x-0">
                <div className="flex items-start justify-between gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className={formTitle}>{t('integration.agentEnabledModels')}</div>
                      {listedModelNames.length ? (
                        <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] px-2 py-0.5 text-[0.7rem] font-medium text-ok">
                          {t('integration.agentEnabledModelsBadge', { enabled: enabledCount, total: listedModelNames.length })}
                        </span>
                      ) : null}
                    </div>
                    <p className={cn(formDesc, 'm-0 mt-1')}>{t('integration.agentEnabledModelsDesc')}</p>
                  </div>
                  <SwitchToggle
                    size="sm"
                    className="mt-0.5"
                    checked={allEnabled ? true : enabledCount > 0 ? 'mixed' : false}
                    disabled={busy === 'save' || modelsBusy || !listedModelNames.length}
                    tooltip={allEnabled ? t('integration.agentEnabledModelsNone') : t('integration.agentEnabledModelsAll')}
                    onCheckedChange={(next) => setEnabledNames(next ? (catalogNames.length ? catalogNames : listedModelNames) : [])}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {listedModelNames.length ? (
                    <ul className="m-0 flex list-none flex-col p-0">
                      {listedModelNames.map((name) => {
                        const label = modelLabels.get(name) || name
                        const checked = isModelEnabled(name, draft.enabledModels)
                        return (
                          <li key={name} className="mx-4 flex items-center justify-between gap-3 border-t border-line py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[0.8125rem] font-medium text-ink">{label}</div>
                              {label !== name ? <div className="mt-0.5 truncate text-[0.7rem] text-ink-soft">{name}</div> : null}
                            </div>
                            <SwitchToggle
                              size="sm"
                              checked={checked}
                              disabled={busy === 'save' || modelsBusy}
                              tooltip={label}
                              onCheckedChange={(next) => {
                                const current = draft.enabledModels ?? catalogNames
                                setEnabledNames(next ? [...current, name] : current.filter((item) => item !== name))
                              }}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="m-0 mx-4 border-t border-line px-0 py-4 text-center text-xs text-ink-soft">
                      {modelsBusy ? t('integration.agentTesting') : t('integration.agentEnabledModelsEmpty')}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            <div className={cn(formFieldInlineWideLabel, !isCliProvider(draft.provider) && 'before:!inset-x-0')}>
              <span className={formTitleInline}>{t('integration.agentDefaultModel')}</span>
              <span className={formDescInline}>{t('integration.agentDefaultModelDesc')}</span>
              <div className={formControlInlineStart}>
                <Combobox
                  className="w-full"
                  value={draft.defaultModel}
                  options={modelOptions}
                  placeholder={t('integration.agentNoModels')}
                  emptyLabel={t('integration.agentModelComboboxEmpty')}
                  loading={modelsBusy}
                  onOpen={loadModelsOnOpen}
                  onChange={(defaultModel) => {
                    const trimmed = defaultModel.trim()
                    const known = trimmed && modelOptions.some((option) => option.value === trimmed)
                    update({
                      defaultModel,
                      ...(known && draft.enabledModels && !draft.enabledModels.includes(trimmed) ? { enabledModels: [...draft.enabledModels, trimmed] } : {}),
                    })
                  }}
                  onSelectOption={(defaultModel) => {
                    const trimmed = defaultModel.trim()
                    update({
                      defaultModel,
                      ...(trimmed && draft.enabledModels && !draft.enabledModels.includes(trimmed) ? { enabledModels: [...draft.enabledModels, trimmed] } : {}),
                    })
                  }}
                />
              </div>
            </div>
            {httpModel ? (
              <>
                <label className={formFieldInlineWideLabel}>
                  <span className={formTitleInline}>{t('integration.agentTemperature')}</span>
                  <span className={formDescInline}>{t('integration.agentTemperatureDesc')}</span>
                  <div className={formControlInlineStart}>
                    <NumberSliderInput
                      className="w-full"
                      value={draft.temperature}
                      min={0}
                      max={2}
                      step={0.1}
                      allowDecimal
                      onValueChange={(temperature) => update({ temperature })}
                    />
                  </div>
                </label>
                {draftProvider === 'ollama' ? (
                  <label className={formFieldInlineWideLabel}>
                    <span className={formTitleInline}>{t('integration.agentKeepAlive')}</span>
                    <span className={formDescInline}>{t('integration.agentKeepAliveDesc')}</span>
                    <div className={formControlInlineStart}>
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
                ) : null}
              </>
            ) : null}
            {httpModel ? (
              <label className={formFieldInlineWideLabel}>
                <span className={formTitleInline}>{t('integration.agentModelRequestTimeout')}</span>
                <span className={formDescInline}>{t('integration.agentModelRequestTimeoutDesc')}</span>
                <div className={formControlInlineStart}>
                  <DurationInput
                    className="w-full"
                    value={draft.modelRequestTimeoutMs}
                    min={1_000}
                    max={600_000}
                    onValueChange={(modelRequestTimeoutMs) => update({ modelRequestTimeoutMs })}
                  />
                </div>
              </label>
            ) : null}
            <label className={formFieldInlineWideLabel}>
              <span className={formTitleInline}>{t(cli ? 'agentAuth.roundTimeout' : 'integration.agentModelTimeout')}</span>
              <span className={formDescInline}>{t(cli ? 'agentAuth.roundTimeoutDesc' : 'integration.agentModelTimeoutDesc')}</span>
              <div className={formControlInlineStart}>
                <DurationInput className="w-full" value={draft.modelTimeoutMs} min={1_000} max={600_000} onValueChange={(modelTimeoutMs) => update({ modelTimeoutMs })} />
              </div>
            </label>
            <label className={formFieldInlineWideLabel}>
              <span className={formTitleInline}>{t('integration.agentGameCallTimeout')}</span>
              <span className={formDescInline}>{t('integration.agentGameCallTimeoutDesc')}</span>
              <div className={formControlInlineStart}>
                <DurationInput className="w-full" value={draft.gameCallTimeoutMs} min={1_000} max={600_000} onValueChange={(gameCallTimeoutMs) => update({ gameCallTimeoutMs })} />
              </div>
            </label>
            <div className={formFieldInlineWideLabel}>
              <span className={formTitleInline}>{t('integration.agentProxy')}</span>
              <span className={cn(formDescInline, draftProxy === null && 'text-fail')}>
                {t(draftProxy === null ? 'integration.agentProxyInvalid' : 'integration.agentProxyDesc')}
              </span>
              <div className={cn(formControlInlineStart, 'flex-col items-stretch gap-1.5')}>
                <AffixedTextInput
                  className="w-full"
                  value={draft.proxy}
                  placeholder="http://127.0.0.1:7890"
                  spellCheck={false}
                  invalid={draftProxy === null}
                  aria-label={t('integration.agentProxy')}
                  endAction={
                    <Tooltip content={t('integration.agentProxyProtocolsShow')}>
                      <button
                        type="button"
                        className={cn(
                          lockIconBtn,
                          (proxyProtocolsOpen || hasProxyOverrides) && 'text-accent hover:enabled:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:enabled:text-accent'
                        )}
                        aria-label={t('integration.agentProxyProtocolsShow')}
                        aria-expanded={proxyProtocolsOpen}
                        aria-pressed={proxyProtocolsOpen}
                        onClick={() => {
                          setProxyProtocolsOpen((open) => {
                            if (!open) setProtocolInherit({})
                            return !open
                          })
                        }}
                      >
                        <IoOptionsOutline size={15} aria-hidden />
                      </button>
                    </Tooltip>
                  }
                  onChange={(event) => update({ proxy: event.target.value })}
                />
                {draftProxySlots && draftProxy ? (
                  <p className="m-0 text-[0.7rem] leading-[1.35] text-ink-soft">
                    {t('integration.agentProxyAppliesTo', {
                      value: draftProxy,
                      slots: 'HTTP / HTTPS / SOCKS5 / ALL',
                    })}
                  </p>
                ) : null}
              </div>
            </div>
            {proxyProtocolsOpen
              ? AGENT_PROXY_PROTOCOL_FIELDS.map((key) => {
                  // Opened panel defaults to editable fill; inherit only after explicit icon toggle.
                  const inherit = protocolInherit[key] === true
                  return (
                    <div key={key} className={formFieldInlineWideLabel}>
                      <span className={formTitleInline}>{key.toUpperCase()}</span>
                      <span className={formDescInline}>{inherit ? t('integration.agentProxyProtocolInherit') : t('integration.agentProxyProtocolOverride')}</span>
                      <div className={formControlInlineStart}>
                        <AgentProxyUrlInput
                          value={draft.proxyProtocols?.[key] || ''}
                          defaultValue={draftProxy || draft.proxy}
                          defaultScheme={defaultAgentProxyUrlScheme(key)}
                          inherit={inherit}
                          aria-label={key.toUpperCase()}
                          onChange={(next) => {
                            if (next.trim()) setProtocolInherit((prev) => ({ ...prev, [key]: false }))
                            setProxyProtocol(key, next)
                          }}
                          onInheritChange={(nextInherit) => {
                            setProtocolInherit((prev) => ({ ...prev, [key]: nextInherit }))
                            if (nextInherit) setProxyProtocol(key, '')
                          }}
                        />
                      </div>
                    </div>
                  )
                })
              : null}
            <div className={cn(formField, 'gap-2')}>
              <div className="min-w-0">
                <div className={formTitle}>{t('integration.agentProxyHeaders')}</div>
                <p className={cn(formDesc, 'm-0 mt-1', draftProxyHeaders === null && 'text-fail')}>
                  {t(draftProxyHeaders === null ? 'integration.agentProxyHeadersInvalid' : 'integration.agentProxyHeadersDesc')}
                </p>
              </div>
              <PlainTextEditor
                language={proxyHeadersDraft.trimStart().startsWith('{') ? 'json' : 'ini'}
                value={proxyHeadersDraft}
                minLines={6}
                heightPx={160}
                softWrap
                aria-label={t('integration.agentProxyHeaders')}
                className={cn(draftProxyHeaders === null && 'border-fail')}
                onChange={setProxyHeadersDraft}
              />
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3" data-agent-detail-toolbar>
              <div className="flex min-w-0 items-center justify-start gap-2">
                <Button variant="ghost" onClick={() => void handleNavigate()}>
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
                <Button loading={busy === 'test'} disabled={proxyInvalid} onClick={() => void test()}>
                  {t('integration.agentTest')}
                </Button>
                <Button variant="accent" disabled={!draft.label.trim() || proxyInvalid} loading={busy === 'save'} onClick={() => void save()}>
                  {t('integration.agentSave')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
