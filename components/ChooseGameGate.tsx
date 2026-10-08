'use client'

import { IoFolderOpenOutline, IoLibraryOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { LaunchHelp } from '@/components/LaunchHelp'
import { GateButton } from '@/components/sk'
import { cn } from '@/lib/utils'

type Props = {
  busy?: boolean
  onChoose: () => void
  className?: string
  /** false 时走云端 Chrome FSA 准备本地游戏 */
  canUseDisk?: boolean
  /**
   * pick：打开系统选目录（游戏库页）
   * library：跳转游戏库选已有条目
   */
  chooseIntent?: 'pick' | 'library'
}

/** 标题 / 两行说明依次淡入；按钮由 size=gate 自带 kit-rise */
const gateRise =
  'motion-safe:[&_h1]:animate-[rise_0.4s_ease_both] motion-safe:[&_p:nth-of-type(1)]:animate-[rise_0.4s_0.04s_ease_both] motion-safe:[&_p:nth-of-type(2)]:animate-[rise_0.4s_0.08s_ease_both]'

const riseKeyframes = `
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
`

/** 未选中游戏时的居中入口：标题 + 说明 + 按钮 */
export function ChooseGameGate({ busy = false, onChoose, className, canUseDisk = true, chooseIntent = 'pick' }: Props) {
  const t = useT()
  const toLibrary = chooseIntent === 'library'
  const Icon = toLibrary ? IoLibraryOutline : IoFolderOpenOutline

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center', gateRise, className)} role="status">
      <style>{riseKeyframes}</style>
      <h1 className="m-0 font-display text-[clamp(1.5rem,3.5vw,1.85rem)] font-semibold tracking-[-0.02em] text-ink">{t('gate.title')}</h1>
      {toLibrary ? (
        <>
          <p className="m-0 max-w-[22rem] text-sm font-normal leading-[1.45] text-ink-soft">{t('gate.libraryLine1')}</p>
          <p className="m-0 max-w-[22rem] text-xs leading-[1.4] text-[color-mix(in_oklab,var(--ink-soft)_78%,transparent)]">{t('gate.libraryLine2')}</p>
        </>
      ) : (
        <>
          <p className="m-0 max-w-[22rem] text-sm font-normal leading-[1.45] text-ink-soft">{t('gate.pickLine1')}</p>
          <p className="m-0 max-w-[22rem] text-xs leading-[1.4] text-[color-mix(in_oklab,var(--ink-soft)_78%,transparent)]">
            {canUseDisk ? t('gate.pickLine2Disk') : t('gate.pickLine2Cloud')}
          </p>
        </>
      )}
      <GateButton icon={<Icon size={18} />} loading={busy} onClick={onChoose}>
        {t('common.chooseGame')}
      </GateButton>
      <LaunchHelp />
    </div>
  )
}
