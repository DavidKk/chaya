import { Fragment, type ReactNode } from 'react'
import { type IconType } from 'react-icons'
import {
  Fa0,
  Fa1,
  Fa2,
  Fa3,
  Fa4,
  Fa5,
  Fa6,
  Fa7,
  Fa8,
  Fa9,
  FaA,
  FaB,
  FaC,
  FaD,
  FaE,
  FaF,
  FaG,
  FaH,
  FaI,
  FaJ,
  FaK,
  FaL,
  FaM,
  FaN,
  FaO,
  FaP,
  FaQ,
  FaR,
  FaS,
  FaT,
  FaU,
  FaV,
  FaW,
  FaX,
  FaY,
  FaZ,
} from 'react-icons/fa6'
import { ImCommand, ImCtrl, ImShift } from 'react-icons/im'
import { LuArrowBigDown, LuArrowBigLeft, LuArrowBigRight, LuArrowBigUp, LuPlus } from 'react-icons/lu'
import { PiBackspaceBold } from 'react-icons/pi'
import { RiCornerDownLeftLine } from 'react-icons/ri'
import { TbFunction, TbOption, TbSquareLetterE } from 'react-icons/tb'

/** 键与键之间的分隔图标（组合键 + / 先后顺序 ›）共用样式 */
export const keySeparator = 'mx-1 inline-block align-[-1px] text-ink-soft'

/** 多字母键名对应的图标；尺寸略大于字母图标 */
const NAMED_ICONS: Record<string, { icon: IconType; label: string }> = {
  ArrowUp: { icon: LuArrowBigUp, label: '上' },
  ArrowDown: { icon: LuArrowBigDown, label: '下' },
  ArrowLeft: { icon: LuArrowBigLeft, label: '左' },
  ArrowRight: { icon: LuArrowBigRight, label: '右' },
  Backspace: { icon: PiBackspaceBold, label: '删除' },
  Enter: { icon: RiCornerDownLeftLine, label: '回车' },
  Escape: { icon: TbSquareLetterE, label: 'Esc' },
  Ctrl: { icon: ImCtrl, label: 'Ctrl' },
  Control: { icon: ImCtrl, label: 'Ctrl' },
  '⌃': { icon: ImCtrl, label: 'Ctrl' },
  Cmd: { icon: ImCommand, label: 'Cmd' },
  Command: { icon: ImCommand, label: 'Cmd' },
  Meta: { icon: ImCommand, label: 'Cmd' },
  '⌘': { icon: ImCommand, label: 'Cmd' },
  Shift: { icon: ImShift, label: 'Shift' },
  '⇧': { icon: ImShift, label: 'Shift' },
  Alt: { icon: TbOption, label: 'Alt' },
  Option: { icon: TbOption, label: 'Alt' },
  Opt: { icon: TbOption, label: 'Alt' },
  '⌥': { icon: TbOption, label: 'Alt' },
  Fn: { icon: TbFunction, label: 'Fn' },
}

/** Mac 修饰符号可紧贴在键名前（如 ⌥⇧⌘A），逐个换成图标 */
const MODIFIER_SYMBOLS = /([⌘⌥⌃⇧])/

const GLYPH_ICONS: Record<string, IconType> = {
  A: FaA,
  B: FaB,
  C: FaC,
  D: FaD,
  E: FaE,
  F: FaF,
  G: FaG,
  H: FaH,
  I: FaI,
  J: FaJ,
  K: FaK,
  L: FaL,
  M: FaM,
  N: FaN,
  O: FaO,
  P: FaP,
  Q: FaQ,
  R: FaR,
  S: FaS,
  T: FaT,
  U: FaU,
  V: FaV,
  W: FaW,
  X: FaX,
  Y: FaY,
  Z: FaZ,
  '0': Fa0,
  '1': Fa1,
  '2': Fa2,
  '3': Fa3,
  '4': Fa4,
  '5': Fa5,
  '6': Fa6,
  '7': Fa7,
  '8': Fa8,
  '9': Fa9,
}

const TOKEN_SPLIT = /(\+|\s+)/
/** 允许前缀 Mac 修饰符号（如 ⌘A、⌘Backspace） */
const PREFIXED_TOKEN = /^([^A-Za-z0-9]*)(.+)$/

function iconFor(token: string): { prefix: string; icon: IconType; label: string; named: boolean } | null {
  const parts = PREFIXED_TOKEN.exec(token)
  if (!parts) return null
  const [, prefix, key] = parts
  const named = NAMED_ICONS[key]
  if (named) return { prefix, ...named, named: true }
  /** 仅单个字母/数字；Ctrl、Space 等多字母键名保持文字 */
  if (!/^[A-Za-z0-9]$/.test(key)) return null
  const char = key.toUpperCase()
  return { prefix, icon: GLYPH_ICONS[char], label: char, named: false }
}

export function hasKeyIcon(text: string): boolean {
  return text.split(TOKEN_SPLIT).some((token) => token === '+' || iconFor(token))
}

/** 按键文本中的修饰键（含 ⌘⌥⌃⇧）、Fn、方向键、Backspace、Enter、Esc、单个字母和数字替换为图标，其余原样输出 */
export function KeyText({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN_SPLIT).map((token, index): ReactNode => {
        if (token === '+') return <LuPlus key={index} size={11} className={keySeparator} aria-label="加" role="img" />
        const match = iconFor(token)
        if (!match) return <Fragment key={index}>{token}</Fragment>
        const Icon = match.icon
        return (
          <Fragment key={index}>
            {match.prefix.split(MODIFIER_SYMBOLS).map((part, partIndex) => {
              const modifier = NAMED_ICONS[part]
              if (!modifier) return part
              const ModifierIcon = modifier.icon
              return <ModifierIcon key={partIndex} size={12} className="mr-px inline-block align-[-1px]" aria-label={modifier.label} role="img" />
            })}
            <Icon size={match.named ? 13 : 11} className="inline-block align-[-1px]" aria-label={match.label} role="img" />
          </Fragment>
        )
      })}
    </>
  )
}
