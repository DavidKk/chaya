'use client'

import { useMemo, useState } from 'react'
import { IoChevronDown, IoChevronForward } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Tooltip } from '@/components/sk'
import { type EventCommand, type EventNames, interpretCommands, type ScriptLine, type ScriptTone } from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const TONE: Record<ScriptTone, string> = {
  text: 'text-ink',
  flow: 'text-info',
  effect: 'text-accent',
  risk: 'text-warn',
  muted: 'text-ink-soft',
}

const linkBtn =
  'm-0 cursor-pointer rounded-[0.15rem] border-none bg-transparent p-0 text-left underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]'

type Props = {
  list: readonly EventCommand[]
  names: EventNames
  texts: Readonly<Record<string, string>>
  onOpenCommon?: (id: number) => void
  onOpenMap?: (id: number) => void
}

/** A line has children when the next line is indented deeper */
function hasChildren(lines: readonly ScriptLine[], index: number) {
  return (lines[index + 1]?.indent ?? -1) > lines[index].indent
}

/** Interpreted command list: indented, collapsible branches, linked calls / transfers, original text on hover */
export function EventScript({ list, names, texts, onOpenCommon, onOpenMap }: Props) {
  const t = useT()
  const lines = useMemo(() => interpretCommands(list, names, texts), [list, names, texts])
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())

  if (!lines.length) return <p className="m-0 px-3 py-2 text-xs text-ink-soft">{t('events.scriptEmpty')}</p>

  const rows: Array<{ line: ScriptLine; index: number }> = []
  let hideBelow: number | null = null
  lines.forEach((line, index) => {
    if (hideBelow != null) {
      if (line.indent > hideBelow) return
      hideBelow = null
    }
    rows.push({ line, index })
    if (collapsed.has(index) && hasChildren(lines, index)) hideBelow = line.indent
  })

  const toggle = (index: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <ol className="m-0 list-none py-1 pl-0 font-mono text-[0.75rem] leading-[1.6]">
      {rows.map(({ line, index }) => {
        const args = line.args ?? {}
        const key: MessageKey = line.key === 'text' && args.speaker ? 'events.cmd.textBy' : (`events.cmd.${line.key}` as MessageKey)
        const label = t(key, args)
        const branch = hasChildren(lines, index)
        const isCollapsed = collapsed.has(index)
        const openLink = line.link?.kind === 'common' ? onOpenCommon : line.link?.kind === 'map' ? onOpenMap : undefined
        return (
          <li key={index} className="flex min-w-0 items-start gap-1 pr-3" style={{ paddingLeft: `${0.5 + line.indent * 1.1}rem` }}>
            {branch ? (
              <button
                type="button"
                className="m-0 mt-[0.2rem] inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[0.15rem] border-none bg-transparent p-0 text-ink-soft hover:text-ink"
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? t('events.expand') : t('events.collapse')}
                onClick={() => toggle(index)}
              >
                {isCollapsed ? <IoChevronForward size={12} aria-hidden /> : <IoChevronDown size={12} aria-hidden />}
              </button>
            ) : (
              <span className="inline-block size-4 shrink-0" aria-hidden />
            )}
            <div className={cn('min-w-0 flex-1', TONE[line.tone])}>
              {openLink && line.link ? (
                <button type="button" className={cn(linkBtn, TONE[line.tone])} onClick={() => openLink(line.link!.id)}>
                  {label}
                </button>
              ) : (
                <span className="break-words">{label}</span>
              )}
              {line.body ? <ScriptBody body={line.body} source={line.source} originalLabel={t('events.original')} /> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ScriptBody({ body, source, originalLabel }: { body: string; source?: string; originalLabel: string }) {
  const block = <div className="mt-0.5 whitespace-pre-wrap break-words rounded-[0.2rem] bg-inset px-2 py-1 font-sans text-[0.78rem] text-ink">{body}</div>
  if (!source) return block
  return (
    <Tooltip content={`${originalLabel}\n${source}`} triggerClassName="block min-w-0">
      {block}
    </Tooltip>
  )
}
