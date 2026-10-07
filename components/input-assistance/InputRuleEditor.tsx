'use client'

import { LuSquare, LuTrash2 } from 'react-icons/lu'

import { Button, SwitchToggle } from '@/components/sk'
import { chordId, chordLabel, type InputChord, type InputRule, intervalLabel, type MacroEvent, macroLabel, validateRule } from '@/lib/game/input-assistance'
import { cn } from '@/lib/utils'

import { InputHotkeyField } from './InputHotkeyField'
import { InputIntervalField } from './InputIntervalField'
import { InputRecorderField } from './InputRecorderField'

/** 表头与规则行共用：内容 | 快捷键 | 启用 | 操作；各列固定宽，保证各行与表头对齐 */
export const ruleGridCols = 'md:grid-cols-[minmax(0,1fr)_9.5rem_3rem_5rem]'
/** 连发多一列间隔：按键 | 间隔 | 快捷键 | 启用 | 操作 */
export const turboGridCols = 'md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_3rem_5rem]'
/** 操作列左侧分隔线，与启用列区分 */
export const ruleOpsCol =
  'md:relative md:pl-2 md:before:absolute md:before:top-1/2 md:before:left-0 md:before:h-3 md:before:-translate-y-1/2 md:before:border-l md:before:border-line md:before:content-[""]'

type Props = {
  rule: InputRule
  warning?: string
  busy: boolean
  active: boolean
  pending: boolean
  count: number
  onUpdate: (rule: InputRule) => Promise<void>
  onToggle: (enabled: boolean) => Promise<void>
  onDelete: () => Promise<void>
  onStop: () => Promise<void>
}

function MobileLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs text-ink-soft md:hidden">{children}</span>
}

export function InputRuleEditor({ rule, warning, busy, active, pending, count, onUpdate, onToggle, onDelete, onStop }: Props) {
  const issue = validateRule(rule)[0]
  const action = rule.kind === 'macro' ? macroLabel(rule.events) : chordLabel(rule.output)
  const trigger = chordLabel(rule.trigger) || '未设置快捷键'
  const save = (changes: Partial<InputRule>) => onUpdate({ ...rule, ...changes } as InputRule)
  const toggleTip = rule.enabled ? (issue ? `已启用，配置完成后生效：${issue.message}` : '禁用规则') : '启用规则'
  const groupLabel =
    rule.kind === 'mapping'
      ? `${trigger} 映射为 ${action || '未录制'}`
      : rule.kind === 'turbo'
        ? `连发 ${action || '未录制'}，间隔 ${intervalLabel(rule.interval)} ms，${trigger}`
        : `${action || '未录制动作'}，${trigger}`
  return (
    <div className="px-4 py-3" role="group" aria-label={groupLabel}>
      <div className={cn('grid min-w-0 grid-cols-2 items-start gap-2 md:items-center', rule.kind === 'turbo' ? turboGridCols : ruleGridCols)}>
        <div className="min-w-0">
          <MobileLabel>{rule.kind === 'mapping' ? '映射为' : rule.kind === 'turbo' ? '连发按键' : '录制动作'}</MobileLabel>
          {rule.kind === 'mapping' ? (
            <InputRecorderField compact label="映射输出" kind="binding" value={rule.output} onChange={(value) => void save({ output: value as InputChord })} disabled={busy} />
          ) : rule.kind === 'turbo' ? (
            <InputRecorderField
              compact
              single
              label="连发按键"
              kind="binding"
              value={rule.output}
              onChange={(value) => {
                const output = value as InputChord
                const followsOutput = !rule.trigger.length || chordId(rule.trigger) === chordId(rule.output)
                void save(followsOutput ? { output, trigger: output } : { output })
              }}
              disabled={busy}
            />
          ) : (
            <InputRecorderField compact label="动作" kind="macro" value={rule.events} onChange={(value) => void save({ events: value as MacroEvent[] })} disabled={busy} />
          )}
        </div>
        {rule.kind === 'turbo' ? (
          <div className="min-w-0">
            <MobileLabel>间隔</MobileLabel>
            <InputIntervalField value={rule.interval} onChange={(interval) => void save({ interval })} disabled={busy} />
          </div>
        ) : null}
        <div className="min-w-0">
          <MobileLabel>快捷键</MobileLabel>
          <InputHotkeyField compact label="快捷键" value={rule.trigger} onChange={(value) => void save({ trigger: value })} warning={warning} disabled={busy} />
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-center">
          <span className="text-xs text-ink-soft md:hidden">启用</span>
          <SwitchToggle variant="ghost" size="sm" checked={rule.enabled} disabled={busy} onCheckedChange={(on) => void onToggle(on)} aria-label={toggleTip} tooltip={toggleTip} />
        </div>
        <div className={cn('flex min-w-0 items-center justify-end gap-1', ruleOpsCol)}>
          <span className="mr-auto text-xs text-ink-soft md:hidden">操作</span>
          {active || pending ? (
            <Button variant="plain" size="icon" aria-label="停止规则" onClick={() => void onStop()}>
              <LuSquare size={14} />
            </Button>
          ) : (
            <span className="w-8 shrink-0" aria-hidden />
          )}
          <Button variant="plain" size="icon" aria-label="删除规则" disabled={busy} onClick={() => void onDelete()}>
            <LuTrash2 size={14} />
          </Button>
        </div>
      </div>
      {active ? <p className="mt-1 text-xs text-ok">运行中 · {count}</p> : pending ? <p className="mt-1 text-xs text-warn">切回游戏后执行</p> : null}
    </div>
  )
}
