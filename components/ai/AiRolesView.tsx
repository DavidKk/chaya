'use client'

import { useCallback, useEffect, useState } from 'react'
import { IoAdd, IoArrowBack, IoFemale, IoMale, IoTrashOutline } from 'react-icons/io5'
import { LuFileCode, LuSave } from 'react-icons/lu'
import { TbPencilCog } from 'react-icons/tb'

import { AvatarDisplay, CompanionAvatarPicker } from '@/components/ai/CompanionAvatarPicker'
import { useConfirm } from '@/components/confirm/ConfirmProvider'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { formCard, formControlInline, formControlInlineStart, formDesc, formFieldInlineWideLabel, formTitle, panelHead, settingsCardWide } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, EmptyState, ScrollArea, Select, TextInput } from '@/components/sk'
import { PlainTextEditor } from '@/components/sk/PlainTextEditor'
import { SegmentedNav } from '@/components/sk/SegmentedNav'
import { useSafeRouter } from '@/components/translate/safe-navigation'
import { type GameAgentProvider } from '@/lib/game-agent/providers'
import { type AiRole, type CompanionSpoilers, type CompanionVerbosity, deleteAiRole, loadAiRoles, saveAiRole, subscribeAiRoles } from '@/lib/game-agent/roles'
import { cn } from '@/lib/utils'

type ConfiguredAgentProfile = {
  id: string
  label: string
  provider: string
  defaultModel: string
  models?: string[]
  enabledModels?: string[]
}

function readLocalProfiles(): ConfiguredAgentProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const syncRaw = localStorage.getItem('chaya.gameAgent.pluginSync.v1')
    if (syncRaw) {
      const doc = JSON.parse(syncRaw)
      const profiles = doc?.values?.profiles || doc?.profiles
      if (Array.isArray(profiles) && profiles.length > 0) return profiles
    }
  } catch {}
  try {
    const runtimeRaw = localStorage.getItem('chaya.agent.runtimeConfig.v1')
    if (runtimeRaw) {
      const cfg = JSON.parse(runtimeRaw)
      if (Array.isArray(cfg?.profiles) && cfg.profiles.length > 0) return cfg.profiles
    }
  } catch {}
  try {
    const legacyRaw = localStorage.getItem('chaya.gameAgent.settings')
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw)
      if (Array.isArray(legacy?.profiles) && legacy.profiles.length > 0) return legacy.profiles
    }
  } catch {}
  return []
}

type Props = {
  roleId?: string
  onNavigate?: (id?: string) => void
  onOpenWorkspace?: (id: string) => void
  request?: GameAgentRequest
}

export function AiRolesView({ roleId, onNavigate, onOpenWorkspace, request }: Props) {
  const t = useT()
  const locale = useLocaleCode()
  const isZh = locale.startsWith('zh')
  const confirm = useConfirm()
  const notify = useNotification()
  const router = useSafeRouter()

  const [roles, setRoles] = useState<AiRole[]>(() => loadAiRoles())
  const [configuredProfiles, setConfiguredProfiles] = useState<ConfiguredAgentProfile[]>(() => readLocalProfiles())

  useEffect(() => {
    let cancelled = false
    const req = request ?? (typeof fetch !== 'undefined' ? fetch : null)
    if (!req) return

    const loadProfiles = async () => {
      try {
        const res = await req('/api/integration/game-agent')
        const data = res.ok ? await res.json().catch(() => null) : null
        if (cancelled) return
        if (data?.settings?.profiles && Array.isArray(data.settings.profiles) && data.settings.profiles.length > 0) {
          setConfiguredProfiles(data.settings.profiles)
          return
        }
      } catch {}

      try {
        const res = await req('/api/game-agent/status')
        const data = res.ok ? await res.json().catch(() => null) : null
        if (cancelled) return
        if (data?.profiles && Array.isArray(data.profiles) && data.profiles.length > 0) {
          setConfiguredProfiles(data.profiles)
          return
        }
      } catch {}

      const local = readLocalProfiles()
      if (!cancelled && local.length > 0) {
        setConfiguredProfiles(local)
      }
    }

    void loadProfiles()

    const onSync = () => {
      const updated = readLocalProfiles()
      if (updated.length > 0 && !cancelled) {
        setConfiguredProfiles(updated)
      }
    }
    window.addEventListener('chaya:agent-settings-synced', onSync)

    return () => {
      cancelled = true
      window.removeEventListener('chaya:agent-settings-synced', onSync)
    }
  }, [request])

  const [draft, setDraft] = useState<AiRole | null>(() => {
    if (!roleId) return null
    if (roleId === 'new') {
      return {
        id: '',
        name: '',
        gender: 'female',
        avatar: 'rin',
        description: '',
        provider: '' as GameAgentProvider,
        model: '',
        lines: [],
        idleLineGeneration: true,
        verbosity: 'normal',
        spoilers: 'avoid',
      }
    }
    const current = loadAiRoles().find((r) => r.id === roleId)
    return current ? { ...current } : null
  })
  const [error, setError] = useState('')

  useEffect(() => {
    const update = () => setRoles(loadAiRoles())
    return subscribeAiRoles(update)
  }, [])

  const isEditing = roleId != null
  const isCreating = roleId === 'new'

  useEffect(() => {
    if (!isEditing) {
      setDraft(null)
      setError('')
      return
    }
    if (isCreating) {
      setDraft({
        id: '',
        name: '',
        gender: 'female',
        avatar: 'rin',
        description: '',
        provider: '' as GameAgentProvider,
        model: '',
        lines: [],
        idleLineGeneration: true,
        verbosity: 'normal',
        spoilers: 'avoid',
      })
      setError('')
    } else {
      const current = roles.find((r) => r.id === roleId)
      if (current) {
        setDraft({
          ...current,
          name: current.name.split(' · ')[0].trim(),
          lines: current.lines || [],
          verbosity: current.verbosity || 'normal',
          spoilers: current.spoilers || 'avoid',
        })
        setError('')
      } else {
        setDraft(null)
        onNavigate?.()
      }
    }
  }, [isEditing, isCreating, roleId, roles, onNavigate, isZh])

  const handleSave = useCallback(() => {
    if (!draft) return
    const name = draft.name.split(' · ')[0].trim()
    const description = draft.description.trim()
    let id = draft.id.trim()
    if (isCreating) {
      if (!id) {
        id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || `role-${Date.now()}`
      }
      if (roles.some((r) => r.id === id)) {
        setError(isZh ? '该旅伴标识已存在，请换一个' : 'Companion ID already exists')
        return
      }
    }
    if (!name) {
      setError(isZh ? '请输入旅伴名称' : 'Please enter companion name')
      return
    }
    if (!description) {
      setError(isZh ? '请输入人设描述' : 'Please enter companion description')
      return
    }

    const selectedProfile = configuredProfiles.find((p) => p.id === draft.provider || p.provider === draft.provider)
    const boundModel = draft.model?.trim() || selectedProfile?.defaultModel || selectedProfile?.models?.[0] || 'auto'

    saveAiRole({
      ...draft,
      id,
      name,
      description,
      gender: draft.gender || 'female',
      avatar: draft.avatar || 'rin',
      provider: draft.provider || ('' as GameAgentProvider),
      model: draft.provider ? boundModel : '',
      lines: draft.lines || [],
      idleLineGeneration: draft.idleLineGeneration !== false,
      verbosity: draft.verbosity || 'normal',
      spoilers: draft.spoilers || 'avoid',
      workspaceFiles: draft.workspaceFiles,
    })

    notify.success(isZh ? '旅伴已保存' : 'Companion saved')
    onNavigate?.()
  }, [draft, isCreating, roles, configuredProfiles, isZh, notify, onNavigate])

  const handleDelete = useCallback(
    async (targetId: string, targetName: string) => {
      const ok = await confirm({
        title: isZh ? '删除旅伴' : 'Delete Companion',
        description: isZh ? `确定要删除旅伴「${targetName}」吗？此操作无法撤销。` : `Are you sure you want to delete companion "${targetName}"?`,
        confirmLabel: isZh ? '删除' : 'Delete',
        confirmVariant: 'fail',
      })
      if (!ok) return
      deleteAiRole(targetId)
      notify.success(isZh ? '已删除旅伴' : 'Companion deleted')
      if (isEditing) {
        onNavigate?.()
      }
    },
    [confirm, isZh, notify, isEditing, onNavigate]
  )

  if (isEditing && draft) {
    const selectedProfile = configuredProfiles.find((p) => p.id === draft.provider || p.provider === draft.provider)

    const agentSelectOptions = [
      { value: '', label: isZh ? '未绑定 Agent（不可运行）' : 'No Agent Bound' },
      ...configuredProfiles.map((p) => ({
        value: p.id,
        label: `${p.label} (${p.provider})`,
      })),
    ]

    const modelOptions: Array<{ value: string; label: string }> = (() => {
      if (!selectedProfile) {
        return [{ value: '', label: isZh ? '请先选择 Agent 实例' : 'Select Agent First' }]
      }
      const models = [...(selectedProfile.models || []), ...(selectedProfile.enabledModels || []), selectedProfile.defaultModel].filter(Boolean) as string[]
      const unique = Array.from(new Set(models))
      if (unique.length === 0) return [{ value: 'auto', label: 'Auto' }]
      return unique.map((m) => ({ value: m, label: m }))
    })()
    const currentModel = draft.model || (selectedProfile ? selectedProfile.defaultModel || 'auto' : '')

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
        {/* 内容头部：仅标题与说明，不放返回/删除/保存按钮 */}
        <div className={panelHead}>
          <div className="flex min-w-0 flex-col">
            <h2 className="m-0 text-sm font-semibold text-ink">{isCreating ? (isZh ? '新建旅伴' : 'New Companion') : `${isZh ? '编辑旅伴' : 'Edit Companion'}: ${draft.name}`}</h2>
            <p className="m-0 truncate text-xs text-ink-soft">
              {isZh ? '配置旅伴基础人设、模型后端与角色空间' : 'Configure companion persona, model backend, and character space'}
            </p>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4">
          <div className={settingsCardWide}>
            {error ? (
              <div role="alert" className="rounded bg-rose-500/15 p-2.5 text-xs text-rose-400">
                {error}
              </div>
            ) : null}

            {/* 基础人设（左右结构表单） */}
            <section className={formCard}>
              <label className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '旅伴标识 (ID)' : 'Companion ID'}</span>
                  <span className={formDesc}>{isZh ? '唯一英文标识符（创建后不可修改）' : 'Unique identifier for the companion'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <TextInput
                    className="w-full"
                    disabled={!isCreating}
                    value={draft.id}
                    onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                    placeholder="例如: alice"
                    spellCheck={false}
                  />
                </div>
              </label>

              <label className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '旅伴名称' : 'Name'}</span>
                  <span className={formDesc}>{isZh ? '展示名称，无需附带性格后缀（如 Nagi、Rin）' : 'Display name, e.g. Nagi, Rin'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <TextInput className="w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如: Rin" />
                </div>
              </label>

              {/* 性别切换：大号圆开关，高度与输入框一致，内部带男女图标 */}
              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '性别' : 'Gender'}</span>
                  <span className={formDesc}>
                    {isZh ? '影响角色自称口吻、代词称谓（他/她）与对话语气人设风格' : 'Sets character self-address, pronouns, and dialogue tone style'}
                  </span>
                </div>
                <div className={formControlInlineStart}>
                  <div className="flex h-8 items-center gap-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.gender !== 'male'}
                      aria-label={isZh ? '切换' : 'Toggle'}
                      onClick={() => setDraft({ ...draft, gender: draft.gender === 'male' ? 'female' : 'male' })}
                      className={cn(
                        'relative inline-flex h-8 w-15 shrink-0 cursor-pointer items-center rounded-full border p-1 transition-colors duration-200 outline-none',
                        draft.gender === 'male' ? 'border-sky-400/40 bg-sky-500/15' : 'border-rose-400/40 bg-rose-500/15'
                      )}
                      title={isZh ? '切换' : 'Toggle'}
                    >
                      <span
                        className={cn(
                          'grid size-6 place-items-center rounded-full font-bold text-xs shadow-md transition-transform duration-200',
                          draft.gender === 'male' ? 'translate-x-7 bg-sky-500 text-white' : 'translate-x-0 bg-rose-500 text-white'
                        )}
                      >
                        {draft.gender === 'male' ? <IoMale size={14} aria-hidden /> : <IoFemale size={14} aria-hidden />}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 头像（方形图片点击下拉预设与上传单个组件） */}
              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '头像' : 'Avatar'}</span>
                  <span className={formDesc}>{isZh ? '点击方形头像下拉挑选形象或上传图片' : 'Click square avatar to pick preset or upload image'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <CompanionAvatarPicker value={draft.avatar} name={draft.name} gender={draft.gender} size="xl" onChange={(avatar) => setDraft({ ...draft, avatar })} />
                </div>
              </div>

              {/* ACP & 模型绑定 */}
              <label className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? 'ACP / Agent 平台' : 'ACP Provider'}</span>
                  <span className={formDesc}>{isZh ? '驱动该旅伴运行的 Agent 协议或后端服务实例' : 'Agent Client Protocol / runtime driver'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <Select
                    className="w-full"
                    value={selectedProfile?.id || draft.provider || ''}
                    options={agentSelectOptions}
                    onChange={(val) => {
                      const nextProfile = configuredProfiles.find((p) => p.id === val || p.provider === val)
                      const nextModel = nextProfile?.defaultModel || nextProfile?.models?.[0] || nextProfile?.enabledModels?.[0] || 'auto'
                      setDraft({
                        ...draft,
                        provider: (val as GameAgentProvider) || ('' as GameAgentProvider),
                        model: nextProfile ? nextModel : '',
                      })
                    }}
                  />
                </div>
              </label>

              <label className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '关联模型 (Model)' : 'Model'}</span>
                  <span className={formDesc}>{isZh ? '选择该旅伴运行使用的大模型。auto 由平台自动推断' : 'Model dropdown selection'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <Select className="w-full" disabled={!selectedProfile} value={currentModel} options={modelOptions} onChange={(val) => setDraft({ ...draft, model: val })} />
                </div>
              </label>

              {/* 发言偏好设置（话量与剧透拆开为两行，使用 SegmentedNav） */}
              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '发言话量' : 'Speech Verbosity'}</span>
                  <span className={formDesc}>{isZh ? '控制旅伴在冒险途中的话量与发言积极性' : 'Control talkativeness during adventures'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <SegmentedNav
                    aria-label={isZh ? '发言话量' : 'Speech Verbosity'}
                    value={draft.verbosity || 'normal'}
                    items={[
                      { id: 'quiet', label: isZh ? '少说' : 'Quiet' },
                      { id: 'normal', label: isZh ? '适中' : 'Normal' },
                      { id: 'chatty', label: isZh ? '多说' : 'Chatty' },
                    ]}
                    onChange={(v) => setDraft({ ...draft, verbosity: v as CompanionVerbosity })}
                  />
                </div>
              </div>

              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '剧透策略' : 'Spoiler Policy'}</span>
                  <span className={formDesc}>{isZh ? '遇到剧情关键点或谜题时是否提前提示' : 'Whether to give hints or spoilers for secrets'}</span>
                </div>
                <div className={formControlInlineStart}>
                  <SegmentedNav
                    aria-label={isZh ? '剧透策略' : 'Spoiler Policy'}
                    value={draft.spoilers || 'avoid'}
                    items={[
                      { id: 'avoid', label: isZh ? '避免' : 'Avoid' },
                      { id: 'allow', label: isZh ? '允许' : 'Allow' },
                    ]}
                    onChange={(v) => setDraft({ ...draft, spoilers: v as CompanionSpoilers })}
                  />
                </div>
              </div>

              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '思考过程' : 'Thinking Process'}</span>
                  <span className={formDesc}>
                    {isZh ? '激活大模型深度思考过程，展示推理逻辑与分析细节' : 'Enable model reasoning / thinking process and display thought chain'}
                  </span>
                </div>
                <div className={formControlInlineStart}>
                  <SegmentedNav
                    aria-label={isZh ? '思考过程' : 'Thinking Process'}
                    value={draft.thinking ? 'on' : 'off'}
                    items={[
                      { id: 'off', label: isZh ? '关闭' : 'Off' },
                      { id: 'on', label: isZh ? '开启' : 'On' },
                    ]}
                    onChange={(v) => setDraft({ ...draft, thinking: v === 'on' })}
                  />
                </div>
              </div>

              {/* 人设描述：上下结构 + PlainTextEditor */}
              <div className="flex flex-col gap-2 p-4">
                <div className="flex flex-col gap-0.5">
                  <span className={formTitle}>{isZh ? '人设描述' : 'Description'}</span>
                  <span className={formDesc}>{isZh ? '性格特征、说话语气与互动风格（直接作为核心 Prompt）' : 'Persona, speaking tone, and behavior style'}</span>
                </div>
                <PlainTextEditor
                  value={draft.description}
                  onChange={(val) => setDraft({ ...draft, description: val })}
                  minLines={4}
                  heightPx={110}
                  aria-label={isZh ? '人设描述' : 'Description'}
                />
              </div>

              {/* 角色空间入口（三级页面，右侧按钮靠右） */}
              <div className={formFieldInlineWideLabel}>
                <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                  <span className={formTitle}>{isZh ? '角色空间' : 'Character Space'}</span>
                  <span className={formDesc}>
                    {isZh ? '存储旅伴心智能力的记忆 (memory)、技能 (skills) 与 Agent 行为规范等文件' : 'Configure companion memory, skills, and persona runtime workspace'}
                  </span>
                </div>
                <div className={formControlInline}>
                  <Button
                    variant="default"
                    size="md"
                    disabled={isCreating}
                    onClick={() => {
                      if (onOpenWorkspace) onOpenWorkspace(draft.id)
                      else if (router) router.push(`/ai/companion/${encodeURIComponent(draft.id)}/workspace`)
                    }}
                    tooltip={isCreating ? (isZh ? '新建旅伴请先保存后再打开角色空间' : 'Please save companion first') : undefined}
                  >
                    <LuFileCode size={15} className="mr-1.5 text-accent" />
                    {isZh ? '打开角色空间' : 'Open Character Space'}
                  </Button>
                </div>
              </div>

              {/* 清理记忆（仅在详情页提供，右侧按钮靠右） */}
              {!isCreating ? (
                <div className={formFieldInlineWideLabel}>
                  <div className="col-start-1 row-span-2 flex flex-col justify-center gap-0.5">
                    <span className={formTitle}>{isZh ? '游玩记忆管理' : 'Memory Management'}</span>
                    <span className={formDesc}>{isZh ? '清理该旅伴在当前游戏积累的剧情记忆与探索经历缓存' : 'Clear play memory and episode cache for this companion'}</span>
                  </div>
                  <div className={formControlInline}>
                    <Button
                      variant="outline-fail"
                      size="md"
                      onClick={async () => {
                        const ok = await confirm({
                          title: isZh ? '清理该旅伴的游玩记忆？' : 'Clear Companion Play Memory?',
                          description: isZh ? '会清空该旅伴在当前游戏内积累的历险记忆与交互经历。此操作无法撤销。' : 'Clears play episodes and memory caches for this companion.',
                          confirmLabel: isZh ? '清理记忆' : 'Clear Memory',
                          confirmVariant: 'fail',
                        })
                        if (!ok) return
                        notify.success(isZh ? '旅伴游玩记忆已清理' : 'Companion memory cleared')
                      }}
                    >
                      <IoTrashOutline size={14} className="mr-1.5" />
                      {isZh ? '清理游玩记忆' : 'Clear Play Memory'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* 底部操作栏：放在卡片内部，返回在左侧，删除与保存在右侧 */}
              <div className="flex items-center justify-between border-t border-line px-4 py-3 bg-panel/40">
                <Button variant="ghost" size="md" onClick={() => onNavigate?.()}>
                  <IoArrowBack size={15} className="mr-1.5" />
                  {isZh ? '返回' : 'Back'}
                </Button>
                <div className="flex items-center gap-2">
                  {!isCreating ? (
                    <Button variant="outline-fail" size="md" onClick={() => handleDelete(draft.id, draft.name)}>
                      <IoTrashOutline size={15} className="mr-1.5" />
                      {isZh ? '删除' : 'Delete'}
                    </Button>
                  ) : null}
                  <Button variant="accent" size="md" onClick={handleSave}>
                    <LuSave size={15} className="mr-1.5" />
                    {isZh ? '保存' : 'Save'}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      {/* 页面头部：标题为「旅伴」，描述与卡片不同 */}
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-sm font-semibold text-ink">{isZh ? '旅伴' : t('nav.companion')}</h2>
          <p className="m-0 truncate text-xs text-ink-soft">{isZh ? '管理你的游戏 AI 旅伴与运行配置' : 'Manage your game AI companions and runtime configurations'}</p>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4">
        <div className={settingsCardWide}>
          {/* 卡片：标题为「角色」，添加按钮参考实例列表结构 */}
          <section className="w-full overflow-hidden rounded-md border border-line bg-panel" data-companion-list-card>
            <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <strong className="block text-sm text-ink">{isZh ? '角色' : 'Characters'}</strong>
                <span className="mt-1 block text-xs leading-[1.35] text-ink-soft">
                  {isZh ? '定义旅伴的人设风格、头像与模型后端' : 'Configure companion persona, avatar, and model backend'}
                </span>
              </div>
              <Button className="shrink-0" variant="accent" onClick={() => onNavigate?.('new')}>
                <IoAdd size={16} />
                {isZh ? '添加角色' : 'Add Character'}
              </Button>
            </div>

            {!roles.length ? (
              <EmptyState
                title={isZh ? '暂无旅伴角色' : 'No companion characters yet'}
                message={isZh ? '点击上方「添加角色」创建新的旅伴人设。' : 'Click Add Character above to create one.'}
              />
            ) : (
              <ul role="list" className="m-0 list-none divide-y divide-line p-0">
                {roles.map((role) => {
                  const boundProfile = configuredProfiles.find((p) => p.id === role.provider || p.provider === role.provider)
                  return (
                    <li key={role.id} role="listitem" data-navigation-id={role.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                      {/* 列表不展示性别 */}
                      <AvatarDisplay avatar={role.avatar} name={role.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-ink">{role.name}</strong>
                          {boundProfile ? (
                            <span className="text-xs text-accent">
                              {boundProfile.label}
                              {role.model ? ` · ${role.model}` : boundProfile.defaultModel ? ` · ${boundProfile.defaultModel}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-soft">{isZh ? '未绑定 Agent' : 'No Agent'}</span>
                          )}
                        </div>
                        <p className="m-0 mt-0.5 truncate text-xs text-ink-soft">{role.description}</p>
                      </div>

                      {/* 编辑与删除按钮：参考实例列表，使用 plain 变体图标按钮 */}
                      <div className="flex shrink-0 items-center gap-px">
                        <Button size="icon" variant="plain" aria-label={isZh ? '编辑' : 'Edit'} onClick={() => onNavigate?.(role.id)}>
                          <TbPencilCog size={16} aria-hidden />
                        </Button>
                        <Button size="icon" variant="plain" className="text-fail" aria-label={isZh ? '删除' : 'Delete'} onClick={() => handleDelete(role.id, role.name)}>
                          <IoTrashOutline size={16} aria-hidden />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

export const AiCompanionView = AiRolesView
