'use client'

import { useMemo, useState } from 'react'
import { LuPlus } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd } from '@/components/layoutClasses'
import { Button, ScrollArea, Skeleton, SkeletonRegion, SwitchToggle, TextInput } from '@/components/sk'
import { bindingWarnings, chordLabel, groupForRule, type InputRule, macroLabel, mergeRules, type RuleGroup } from '@/lib/game/input-assistance'
import { cn } from '@/lib/utils'

import { InputRuleEditor, ruleGridCols, ruleOpsCol, turboGridCols } from './InputRuleEditor'
import { useInputAssistance } from './useInputAssistance'

type Group = { id: RuleGroup; label: string; description: string; cols: string; columns: ReadonlyArray<{ label: string; center?: boolean }> }

const GROUPS: readonly Group[] = [
  {
    id: 'turbo',
    label: '键鼠连发',
    description: '按一次快捷键开始连发单个按键，再按一次停止；快捷键默认就是连发键',
    cols: turboGridCols,
    columns: [{ label: '连发按键' }, { label: '间隔 ms', center: true }, { label: '快捷键', center: true }],
  },
  {
    id: 'action',
    label: '键鼠动作',
    description: '录制键盘和鼠标操作，按快捷键执行一次',
    cols: ruleGridCols,
    columns: [{ label: '录制动作' }, { label: '快捷键', center: true }],
  },
  {
    id: 'mapping',
    label: '键鼠映射',
    description: '按住一个键或鼠标键时，改为输出另一组键鼠输入',
    cols: ruleGridCols,
    columns: [{ label: '映射为' }, { label: '快捷键', center: true }],
  },
]

const SKELETON_ROWS = 2

function RulesSkeleton({ group }: { group: Group }) {
  return (
    <SkeletonRegion label={`正在读取${group.label}`} className="divide-y divide-line">
      <div className={cn('hidden items-center gap-2 px-4 py-2 md:grid', group.cols)}>
        {group.columns.map((column, index) => (
          <Skeleton key={index} className={cn('h-[0.55rem]', column.center ? 'mx-auto w-10' : 'w-14')} />
        ))}
        <Skeleton className="mx-auto h-3.5 w-6 rounded-full" />
        <Skeleton className="ml-auto h-[0.55rem] w-8" />
      </div>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <div key={row} className={cn('grid grid-cols-2 items-center gap-2 px-4 py-3', group.cols)}>
          {group.columns.map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
          <Skeleton className="mx-auto h-3.5 w-6 rounded-full" />
          <div className="flex justify-end gap-1">
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

function newRule(group: RuleGroup): InputRule {
  const id = crypto.randomUUID()
  const base = { id, name: `规则 ${id.slice(0, 8)}`, enabled: true, trigger: [], originalInput: 'replace' as const }
  if (group === 'mapping') return { ...base, kind: 'mapping', output: [] }
  if (group === 'turbo') return { ...base, kind: 'turbo', output: [], interval: { minMs: 100, maxMs: 100 } }
  return { ...base, kind: 'macro', events: [], repeat: { enabled: false, intervalMs: 100 }, mousePosition: 'current' }
}

export function InputAssistancePage() {
  const { roomId, connected, loading, ready, error, setError, globalConfig, gameConfig, status, save, control } = useInputAssistance()
  const t = useT()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const reading = !ready
  const allRules = useMemo(() => mergeRules(globalConfig.rules, gameConfig.rules), [globalConfig, gameConfig])
  const warnings = useMemo(() => bindingWarnings(allRules), [allRules])
  const filtered = useMemo(
    () =>
      allRules.filter((rule) =>
        `${rule.name} ${chordLabel(rule.trigger)} ${rule.kind === 'macro' ? macroLabel(rule.events) : chordLabel(rule.output)}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      ),
    [allRules, query]
  )

  function scopeFor(rule: InputRule): 'global' | 'game' {
    return gameConfig.rules.some((item) => item.id === rule.id) ? 'game' : 'global'
  }

  async function put(rule: InputRule, scope: 'global' | 'game') {
    const config = scope === 'global' ? globalConfig : gameConfig
    const rules = config.rules.filter((item) => item.id !== rule.id)
    if (rules.some((item) => item.name === rule.name)) throw new Error('此范围内已有同名规则')
    await save(scope, { version: 1, revision: config.revision + 1, rules: [...rules, rule] })
  }

  async function remove(rule: InputRule) {
    const scope = scopeFor(rule)
    const config = scope === 'global' ? globalConfig : gameConfig
    await save(scope, { version: 1, revision: config.revision + 1, rules: config.rules.filter((item) => item.id !== rule.id) })
  }

  async function toggle(rule: InputRule, enabled: boolean) {
    setBusy(true)
    try {
      await put({ ...rule, enabled }, scopeFor(rule))
      if (!enabled && connected) await control('stop', rule.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function toggleAll(rules: readonly InputRule[], enabled: boolean) {
    const targets = rules.filter((rule) => rule.enabled !== enabled)
    if (!targets.length) return
    const ids = new Set(targets.map((rule) => rule.id))
    const gameIds = new Set(targets.filter((rule) => gameConfig.rules.some((item) => item.id === rule.id)).map((rule) => rule.id))
    const globalIds = new Set(targets.filter((rule) => !gameIds.has(rule.id)).map((rule) => rule.id))
    setBusy(true)
    try {
      if (globalIds.size)
        await save('global', {
          ...globalConfig,
          revision: globalConfig.revision + 1,
          rules: globalConfig.rules.map((rule) => (globalIds.has(rule.id) ? { ...rule, enabled } : rule)),
        })
      if (gameIds.size)
        await save('game', { ...gameConfig, revision: gameConfig.revision + 1, rules: gameConfig.rules.map((rule) => (gameIds.has(rule.id) ? { ...rule, enabled } : rule)) })
      if (!enabled && connected) for (const id of ids) await control('stop', id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function updateRule(rule: InputRule) {
    if (busy) return
    setBusy(true)
    try {
      await put(rule, scopeFor(rule))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function addRule(group: RuleGroup) {
    setBusy(true)
    try {
      await put(newRule(group), roomId ? 'game' : 'global')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function deleteRule(rule: InputRule) {
    setBusy(true)
    try {
      await remove(rule)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('nav.keyMouse')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">设置连发、录制键鼠动作和按键映射，在游戏中按快捷键触发</p>
        </div>
        <div className={panelHeadEnd}>
          <TextInput search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选规则" aria-label="筛选规则" className="w-56" />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': '辅助规则' }}>
        <div className="flex w-full max-w-3xl flex-col gap-4 p-4">
          {error ? (
            <p role="alert" className="text-xs text-fail">
              {error}
            </p>
          ) : null}
          {status.error ? (
            <p role="alert" className="text-xs text-fail">
              {status.error}
            </p>
          ) : null}
          {GROUPS.map((group) => {
            const groupRules = allRules.filter((rule) => groupForRule(rule) === group.id)
            const rules = filtered.filter((rule) => groupForRule(rule) === group.id)
            const total = groupRules.length
            const onCount = groupRules.filter((rule) => rule.enabled).length
            const groupChecked = onCount === total ? true : onCount === 0 ? false : 'mixed'
            const groupTip = groupChecked === true ? `全部禁用${group.label}` : `全部启用${group.label}`
            return (
              <section key={group.id} className="w-full overflow-hidden rounded-md border border-line bg-panel" aria-labelledby={`assist-group-${group.id}`}>
                <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2 id={`assist-group-${group.id}`} className="text-sm font-semibold text-ink">
                      {group.label}
                    </h2>
                    <p className="mt-1 text-xs leading-[1.35] text-ink-soft">
                      {group.description}
                      {reading ? null : ` · ${total} 项`}
                    </p>
                  </div>
                  <Button className="shrink-0" variant="accent" onClick={() => void addRule(group.id)} disabled={busy || reading || loading}>
                    <LuPlus size={14} />
                    添加
                  </Button>
                </div>
                {reading ? (
                  <RulesSkeleton group={group} />
                ) : (
                  <div className="divide-y divide-line">
                    {rules.length ? (
                      <div className={cn('hidden gap-2 px-4 py-2 text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase md:grid', group.cols)}>
                        {group.columns.map((column, index) => (
                          <span key={index} className={column.center ? 'text-center' : undefined}>
                            {column.label}
                          </span>
                        ))}
                        <span className="flex items-center justify-center">
                          <SwitchToggle
                            variant="ghost"
                            size="sm"
                            checked={groupChecked}
                            disabled={busy}
                            onCheckedChange={(on) => void toggleAll(groupRules, on)}
                            aria-label={groupTip}
                            tooltip={groupTip}
                          />
                        </span>
                        <span className={cn('flex items-center justify-end', ruleOpsCol)}>操作</span>
                      </div>
                    ) : null}
                    {!rules.length ? (
                      <div role="status" className="flex min-h-20 items-center justify-center px-4 text-xs text-ink-soft">
                        {query.trim() && total ? '没有匹配的规则' : '暂无规则'}
                      </div>
                    ) : null}
                    {rules.map((rule) => {
                      const active = status.running.includes(rule.id)
                      const pending = status.pending.includes(rule.id)
                      return (
                        <InputRuleEditor
                          key={rule.id}
                          rule={rule}
                          warning={warnings.find((item) => item.ruleId === rule.id && item.field === 'trigger')?.message}
                          busy={busy}
                          active={active}
                          pending={pending}
                          count={status.counts[rule.id] ?? 0}
                          onUpdate={updateRule}
                          onToggle={(enabled) => toggle(rule, enabled)}
                          onDelete={() => deleteRule(rule)}
                          onStop={() => control('stop', rule.id)}
                        />
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
