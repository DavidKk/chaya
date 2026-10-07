'use client'

import { useMemo, useState } from 'react'
import { IoPlayOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { Badge, type BadgeTone, Button, TextInput, Tooltip } from '@/components/sk'
import { analyzeFlow, type EventCommand, type EventNames, type FlowMark, interpretCommands, type ScriptTone } from '@/lib/game/events'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { type ScriptLive, ScriptValue } from './ScriptValue'

const TONE: Record<ScriptTone, string> = {
  text: 'text-ink',
  flow: 'text-info',
  effect: 'text-accent',
  risk: 'text-warn',
  muted: 'text-ink-soft',
}

const MARK_ROW: Record<FlowMark, string> = { run: '', skip: 'opacity-35', maybe: 'opacity-60' }
/** Rows inside a branch get a left bar so the branch reads as a group without indenting */
const MARK_BAR: Record<FlowMark, string> = {
  run: 'shadow-[inset_2px_0_0_var(--accent)]',
  skip: 'shadow-[inset_2px_0_0_var(--line)]',
  maybe: 'shadow-[inset_2px_0_0_color-mix(in_oklab,var(--warn)_55%,transparent)]',
}
const MARK_BADGE: Record<FlowMark, { tone: BadgeTone; key: MessageKey; tip: MessageKey }> = {
  run: { tone: 'ok', key: 'events.flowRun', tip: 'events.flowRunTip' },
  skip: { tone: 'neutral', key: 'events.flowSkip', tip: 'events.flowSkipTip' },
  maybe: { tone: 'warn', key: 'events.flowMaybe', tip: 'events.flowMaybeTip' },
}

/** ID · content · actions */
const gridCols = { gridTemplateColumns: '4rem minmax(0, 1fr) 8rem' }

const linkBtn =
  'm-0 cursor-pointer rounded-[0.15rem] border-none bg-transparent p-0 text-left underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]'

type Props = {
  list: readonly EventCommand[]
  names: EventNames
  texts: Readonly<Record<string, string>>
  onOpenCommon?: (id: number) => void
  onOpenMap?: (id: number) => void
  /** Run the list from a command index; omitted → no run buttons */
  onRunFrom?: (at: number) => void
  /** Reason the run buttons are disabled */
  runBlocked?: string
  busy?: boolean
  /** Live values: decide which branches run and allow editing switches / variables in place */
  live?: ScriptLive | null
}

/**
 * Interpreted command list as flat numbered rows. Branch headers say whether their lines run with the
 * current values; lines that won't run are dimmed, undecidable ones greyed. Run from any row.
 */
export function EventScript({ list, names, texts, onOpenCommon, onOpenMap, onRunFrom, runBlocked, busy, live }: Props) {
  const t = useT()
  const lines = useMemo(() => interpretCommands(list, names, texts), [list, names, texts])
  const flow = useMemo(() => analyzeFlow(list, live?.state ?? null), [list, live?.state])
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()

  if (!lines.length) return <p className="m-0 px-3 py-2 text-xs text-ink-soft">{t('events.scriptEmpty')}</p>

  const rows = lines.map((line, index) => {
    const args = line.args ?? {}
    const key: MessageKey = line.key === 'text' && args.speaker ? 'events.cmd.textBy' : (`events.cmd.${line.key}` as MessageKey)
    return { line, index, args, label: t(key, args) }
  })
  const shown = needle ? rows.filter((r) => [r.label, r.line.body, r.line.source].some((s) => s?.toLocaleLowerCase().includes(needle))) : rows

  return (
    <>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0">
        <TextInput
          search
          type="search"
          className="h-8 w-full min-w-0 text-[0.8125rem]"
          value={query}
          placeholder={t('events.scriptSearch')}
          aria-label={t('events.scriptSearch')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {needle ? <span className="shrink-0 text-[0.7rem] tabular-nums text-ink-soft">{`${shown.length} / ${rows.length}`}</span> : null}
      </div>
      <div className="border-t border-line text-[0.78rem] leading-[1.6]" role="table" aria-label={t('events.script')}>
        <div className="grid items-center border-b border-line bg-paper-2" style={gridCols} role="row">
          <div className={editHeadCell} role="columnheader">
            {t('events.scriptColId')}
          </div>
          <div className={editHeadCell} role="columnheader">
            {t('events.scriptColContent')}
          </div>
          <div className={cn(editHeadCell, 'text-right')} role="columnheader">
            {t('events.scriptColActions')}
          </div>
        </div>
        {shown.length ? (
          shown.map(({ line, index, args, label }, i) => {
            const openLink = line.link?.kind === 'common' ? onOpenCommon : line.link?.kind === 'map' ? onOpenMap : undefined
            const mark = flow.marks[line.at] ?? 'run'
            const body = flow.bodies[line.at]
            return (
              <div
                key={index}
                style={gridCols}
                className={cn(
                  'group grid items-start border-t border-line transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]',
                  i === 0 && 'border-t-0',
                  line.indent > 0 && MARK_BAR[mark]
                )}
                role="row"
              >
                <div className={cn(editCell, 'min-w-0 truncate font-mono text-[0.72rem] tabular-nums text-ink-soft')} title={String(index + 1)} role="cell">
                  {index + 1}
                </div>
                <div className={cn(editCell, 'min-w-0 transition-opacity group-hover:opacity-100', TONE[line.tone], MARK_ROW[mark])} role="cell">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {openLink && line.link ? (
                      <button type="button" className={cn(linkBtn, TONE[line.tone])} onClick={() => openLink(line.link!.id)}>
                        {label}
                      </button>
                    ) : (
                      <span className="break-words">{label}</span>
                    )}
                    {body ? (
                      <Tooltip content={t(MARK_BADGE[body].tip)}>
                        <Badge dot={false} tone={MARK_BADGE[body].tone}>
                          {t(MARK_BADGE[body].key)}
                        </Badge>
                      </Tooltip>
                    ) : null}
                  </div>
                  {line.body ? <ScriptBody body={line.body} source={line.source} originalLabel={t('events.original')} /> : null}
                </div>
                <div className={cn(editCell, 'flex items-start justify-end gap-2')} role="cell">
                  {line.ref && live ? <ScriptValue target={line.ref} label={String(args.target ?? label)} live={live} list={list} /> : null}
                  {onRunFrom ? (
                    <Button
                      size="icon"
                      className="h-6 w-6"
                      tooltip={runBlocked || t('events.runFrom', { n: index + 1 })}
                      aria-label={t('events.runFrom', { n: index + 1 })}
                      disabled={!!runBlocked || busy}
                      onClick={() => onRunFrom(line.at)}
                    >
                      <IoPlayOutline size={13} aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })
        ) : (
          <p className="m-0 px-3 py-2 text-xs text-ink-soft">{t('edit.noMatch')}</p>
        )}
      </div>
    </>
  )
}

function ScriptBody({ body, source, originalLabel }: { body: string; source?: string; originalLabel: string }) {
  const block = <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[0.75rem] leading-[1.55] text-ink-soft">{body}</p>
  if (!source) return block
  return (
    <Tooltip content={`${originalLabel}\n${source}`} triggerClassName="block min-w-0">
      {block}
    </Tooltip>
  )
}
