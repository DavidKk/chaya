'use client'

import { Popover } from '@base-ui/react/popover'
import { Bot } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IoCheckmark, IoChevronBack, IoChevronDown, IoRefreshOutline } from 'react-icons/io5'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { ScrollArea, TextInput, TruncateText } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import { cn } from '@/lib/utils'

type Profile = {
  id: string
  label: string
  online: boolean
  models: { name: string }[]
  defaultModel: string
}

type Props = {
  profiles: Profile[]
  profileId: string
  model: string
  disabled?: boolean
  compact?: boolean
  onChange: (profileId: string, model: string) => void
}

type View = 'root' | 'profile' | 'model'

const SEARCH_THRESHOLD = 10

const COPY = {
  zh: { trigger: '选择平台与模型', profile: '平台', model: '模型', reset: '恢复默认', back: '返回', search: '搜索模型…', empty: '没有可用模型' },
  en: {
    trigger: 'Choose provider and model',
    profile: 'Provider',
    model: 'Model',
    reset: 'Reset to default',
    back: 'Back',
    search: 'Search models…',
    empty: 'No models available',
  },
  ja: {
    trigger: 'プロバイダーとモデルを選択',
    profile: 'プロバイダー',
    model: 'モデル',
    reset: '既定に戻す',
    back: '戻る',
    search: 'モデルを検索…',
    empty: '利用可能なモデルがありません',
  },
  ko: { trigger: '공급자 및 모델 선택', profile: '공급자', model: '모델', reset: '기본값 복원', back: '뒤로', search: '모델 검색…', empty: '사용 가능한 모델이 없습니다' },
} as const

export function GameAgentRuntimeMenu({ profiles, profileId, model, disabled = false, compact = false, onChange }: Props) {
  const locale = useLocaleCode()
  const copy = COPY[locale] || COPY.en
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const [query, setQuery] = useState('')
  const profile = profiles.find((item) => item.id === profileId) || null
  const modelOptions = profile?.models || []
  const searchable = modelOptions.length > SEARCH_THRESHOLD
  const needle = query.trim().toLocaleLowerCase()
  const visibleModels = needle ? modelOptions.filter((item) => item.name.toLocaleLowerCase().includes(needle)) : modelOptions
  const label = profile && model ? `${profile.label} · ${model}` : profile?.label || copy.trigger

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [])

  useEffect(() => {
    if (open) return
    setView('root')
    setQuery('')
  }, [open])

  const chooseProfile = (nextId: string) => {
    const next = profiles.find((item) => item.id === nextId)
    if (!next) return
    onChange(next.id, next.defaultModel || next.models[0]?.name || '')
    setView('root')
  }

  const chooseModel = (nextModel: string) => {
    if (!profile) return
    onChange(profile.id, nextModel)
    setView('root')
  }

  const reset = () => {
    const first = profiles[0]
    if (first) onChange(first.id, first.defaultModel || first.models[0]?.name || '')
    setOpen(false)
  }

  return (
    <span ref={anchorRef} className={compact ? 'inline-flex shrink-0' : 'inline-flex min-w-0 max-w-40 shrink'}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          disabled={disabled || profiles.length === 0}
          aria-label={compact ? `${copy.trigger}: ${label}` : copy.trigger}
          title={compact ? label : undefined}
          className={cn(
            'inline-flex items-center gap-1 overflow-hidden text-xs font-medium text-ink-soft outline-none transition-colors hover:enabled:bg-[rgb(230_238_248/0.06)] hover:enabled:text-ink focus-visible:outline-2 focus-visible:outline-accent',
            controlDisabled,
            compact ? 'h-6 w-6 justify-center rounded-sm [@media(hover:none)]:h-11 [@media(hover:none)]:w-11' : 'h-8 min-w-0 max-w-full rounded-full px-1'
          )}
        >
          {compact ? (
            <Bot size={15} aria-hidden />
          ) : (
            <>
              <TruncateText text={label} className="whitespace-nowrap" />
              <IoChevronDown className={cn('shrink-0 transition-transform', open && 'rotate-180')} size={13} aria-hidden />
            </>
          )}
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Positioner side="top" align="start" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Popover.Popup
              aria-label={copy.trigger}
              className="w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line bg-panel-2 shadow-[0_12px_32px_rgb(0_0_0/0.4)] outline-none"
            >
              {view === 'root' ? (
                <div className="py-1">
                  <MenuValueRow label={copy.profile} value={profile?.label || copy.trigger} disabled={profiles.length === 0} onClick={() => setView('profile')} />
                  <MenuValueRow label={copy.model} value={model || copy.empty} disabled={!profile?.online || modelOptions.length === 0} onClick={() => setView('model')} />
                  <div className="my-1 border-t border-line-soft" />
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-ink-soft transition hover:bg-[rgb(230_238_248/0.06)] hover:text-ink"
                    onClick={reset}
                  >
                    <span>{copy.reset}</span>
                    <IoRefreshOutline size={15} aria-hidden />
                  </button>
                </div>
              ) : null}

              {view === 'profile' ? (
                <MenuOptions title={copy.profile} backLabel={copy.back} onBack={() => setView('root')}>
                  {profiles.map((item) => (
                    <MenuOption key={item.id} label={item.label} selected={item.id === profileId} onClick={() => chooseProfile(item.id)} />
                  ))}
                </MenuOptions>
              ) : null}

              {view === 'model' ? (
                <MenuOptions title={copy.model} backLabel={copy.back} onBack={() => setView('root')}>
                  {searchable ? (
                    <div className="border-b border-line-soft p-2">
                      <TextInput
                        type="search"
                        search
                        fullWidth
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={copy.search}
                        aria-label={copy.search}
                      />
                    </div>
                  ) : null}
                  <ScrollArea className="max-h-56" scrollClassName="max-h-56" reserveGutter={false}>
                    <div className="py-1">
                      {visibleModels.length ? (
                        visibleModels.map((item) => <MenuOption key={item.name} label={item.name} selected={item.name === model} onClick={() => chooseModel(item.name)} />)
                      ) : (
                        <p className="m-0 px-3 py-2 text-xs text-ink-soft">{copy.empty}</p>
                      )}
                    </div>
                  </ScrollArea>
                </MenuOptions>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  )
}

function MenuValueRow({ label, value, disabled, onClick }: { label: string; value: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition hover:enabled:bg-[rgb(230_238_248/0.06)]', controlDisabled)}
      onClick={onClick}
    >
      <span className="shrink-0 text-ink-soft">{label}</span>
      <TruncateText text={value} className="text-right font-semibold text-ink" />
    </button>
  )
}

function MenuOptions({ title, backLabel, onBack, children }: { title: string; backLabel: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 border-b border-line-soft px-3 py-2 text-left text-xs text-ink-soft transition hover:bg-[rgb(230_238_248/0.06)] hover:text-ink"
        aria-label={`${backLabel}: ${title}`}
        onClick={onBack}
      >
        <IoChevronBack size={14} aria-hidden />
        <span>{title}</span>
      </button>
      {children}
    </div>
  )
}

function MenuOption({ label, selected, disabled, onClick }: { label: string; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-ink transition hover:enabled:bg-[rgb(230_238_248/0.06)]',
        controlDisabled,
        selected && 'text-accent'
      )}
      onClick={onClick}
    >
      <TruncateText text={label} />
      {selected ? <IoCheckmark size={14} className="shrink-0" aria-hidden /> : null}
    </button>
  )
}
