'use client'

import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from 'react'

import { MonacoEditor } from '@/components/sk/MonacoEditor'
import { CHAYA_MONACO_THEME, CHAYA_PLAINTEXT_EDITOR_OPTIONS, setupChayaMonacoTheme } from '@/components/sk/MonacoEditor/chaya-monaco-theme'
import { Spinner } from '@/components/sk/Spinner'
import { cn } from '@/lib/utils'

/** Default minimum visible rows for short game strings. */
export const PLAIN_TEXT_EDITOR_MIN_LINES = 2

export const PLAIN_TEXT_EDITOR_LINE_H = CHAYA_PLAINTEXT_EDITOR_OPTIONS.lineHeight
const PAD_Y = CHAYA_PLAINTEXT_EDITOR_OPTIONS.padding.top + CHAYA_PLAINTEXT_EDITOR_OPTIONS.padding.bottom

/** Shared chrome so custom line UIs (e.g. break badges) match Monaco editors. */
export const plainTextEditorShellClass = 'min-w-0 overflow-hidden rounded-[0.15rem] border border-line bg-panel'
export const plainTextEditorGutterClass = cn(
  'flex shrink-0 select-none flex-col border-r border-line bg-[color-mix(in_oklab,var(--ink-soft)_8%,transparent)] py-1.5 pl-2 pr-1.5 text-right font-mono text-[0.68rem] leading-5 text-ink-soft'
)

export type PlainTextEditorProps = {
  value: string
  onChange?: (value: string) => void
  disabled?: boolean
  /** false：只在 `\\n` 处分行并横向滚动；true：软折行。 */
  softWrap?: boolean
  /** Minimum visible rows (default {@link PLAIN_TEXT_EDITOR_MIN_LINES}). */
  minLines?: number
  /** Stretch to parent height. Ignores content/`heightPx` sizing. */
  fill?: boolean
  /** Force height in px (e.g. pair left/right via `pairedPlainTextHeightPx`). Ignored when `fill`. */
  heightPx?: number
  className?: string
  highlights?: Array<{ start: number; end: number; tone: 'ok' | 'warn'; label: string }>
  'aria-label': string
  /** 滚动条模式：'default' 保留默认；'none' 或 'hidden' 完全隐藏且不截获鼠标滚轮事件 */
  scrollbar?: 'default' | 'none' | 'hidden'
  /** 是否隐藏所有滚动条并放通滚轮事件给外部容器（等同于 scrollbar="none"） */
  noScrollbars?: boolean
}

export function plainTextEditorHeightPx(value: string, minLines = PLAIN_TEXT_EDITOR_MIN_LINES): number {
  const lines = Math.max(minLines, Math.max(1, value.split('\n').length))
  return lines * PLAIN_TEXT_EDITOR_LINE_H + PAD_Y
}

/** Left/right pair: match both to the taller side (optional cap). */
export function pairedPlainTextHeightPx(left: string, right: string, opts?: { minLines?: number; maxPx?: number }): number {
  const minLines = opts?.minLines ?? PLAIN_TEXT_EDITOR_MIN_LINES
  const h = Math.max(plainTextEditorHeightPx(left, minLines), plainTextEditorHeightPx(right, minLines))
  return opts?.maxPx != null ? Math.min(h, opts.maxPx) : h
}

/**
 * Chaya plaintext editor — Monaco wrapped for console / GameEdit.
 * Prefer this over raw `@monaco-editor/react` so min-lines, theme, and sizing stay consistent.
 */
export function PlainTextEditor({
  value,
  onChange,
  disabled,
  softWrap = true,
  minLines = PLAIN_TEXT_EDITOR_MIN_LINES,
  fill,
  heightPx,
  className,
  highlights,
  'aria-label': ariaLabel,
  scrollbar = 'default',
  noScrollbars,
}: PlainTextEditorProps) {
  const hideScrollbars = Boolean(noScrollbars || scrollbar === 'none' || scrollbar === 'hidden')
  const height = fill ? '100%' : (heightPx ?? plainTextEditorHeightPx(value, minLines))
  const [editor, setEditor] = useState<Parameters<NonNullable<ComponentProps<typeof MonacoEditor>['onMount']>>[0] | null>(null)

  useEffect(() => {
    const model = editor?.getModel()
    if (!editor || !model) return
    const decorations = editor.createDecorationsCollection(
      (highlights || []).map((span) => {
        const start = model.getPositionAt(span.start)
        const end = model.getPositionAt(span.end)
        return {
          range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
          options: {
            // Monaco strips punctuation from decoration classes; apply priority on the shell instead.
            inlineClassName: span.tone === 'ok' ? 'text-ok' : 'text-warn',
            hoverMessage: { value: span.label },
          },
        }
      })
    )
    return () => decorations.clear()
  }, [editor, highlights, value])

  useEffect(() => {
    if (!editor) return
    editor.updateOptions({
      scrollbar: hideScrollbars
        ? {
            vertical: 'hidden',
            horizontal: 'hidden',
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 0,
            alwaysConsumeMouseWheel: false,
            handleMouseWheel: false,
          }
        : CHAYA_PLAINTEXT_EDITOR_OPTIONS.scrollbar,
    })
  }, [editor, hideScrollbars])

  const handleMount = useCallback(
    (editor: Parameters<NonNullable<ComponentProps<typeof MonacoEditor>['onMount']>>[0], monaco: Parameters<NonNullable<ComponentProps<typeof MonacoEditor>['onMount']>>[1]) => {
      setupChayaMonacoTheme(monaco)
      monaco.editor.setTheme(CHAYA_MONACO_THEME)
      editor.updateOptions({
        ariaLabel,
        unicodeHighlight: {
          ambiguousCharacters: false,
          invisibleCharacters: false,
          nonBasicASCII: false,
          includeComments: false,
          includeStrings: false,
        },
        ...(hideScrollbars
          ? {
              scrollbar: {
                vertical: 'hidden',
                horizontal: 'hidden',
                verticalScrollbarSize: 0,
                horizontalScrollbarSize: 0,
                alwaysConsumeMouseWheel: false,
                handleMouseWheel: false,
              },
            }
          : {}),
      })
      setEditor(editor)
    },
    [ariaLabel, hideScrollbars]
  )

  return (
    <div
      className={cn(
        plainTextEditorShellClass,
        fill && 'min-h-0 flex-1 self-stretch',
        hideScrollbars && '[&_.scrollbar]:!hidden [&_.monaco-scrollable-element>.scrollbar]:!hidden',
        highlights?.length && '[&_.text-ok]:!text-ok [&_.text-warn]:!text-warn',
        className
      )}
      style={fill ? undefined : { height }}
    >
      <MonacoEditor
        language="plaintext"
        theme={CHAYA_MONACO_THEME}
        height={height}
        value={value}
        options={{
          ...CHAYA_PLAINTEXT_EDITOR_OPTIONS,
          wordWrap: softWrap ? 'on' : 'off',
          readOnly: disabled || !onChange,
          domReadOnly: disabled || !onChange,
          scrollbar: hideScrollbars
            ? {
                vertical: 'hidden',
                horizontal: 'hidden',
                verticalScrollbarSize: 0,
                horizontalScrollbarSize: 0,
                alwaysConsumeMouseWheel: false,
                handleMouseWheel: false,
              }
            : CHAYA_PLAINTEXT_EDITOR_OPTIONS.scrollbar,
        }}
        onChange={(next) => {
          if (disabled || !onChange) return
          onChange(next ?? '')
        }}
        onMount={handleMount}
        loading={
          <div className="flex h-full items-center justify-center px-3 py-2 text-ink-soft">
            <Spinner size="sm" />
          </div>
        }
      />
    </div>
  )
}

/** Read-only line chrome matching {@link PlainTextEditor}; body is custom (e.g. inline break badges). */
export function PlainTextEditorFrame({
  lineCount,
  minLines = PLAIN_TEXT_EDITOR_MIN_LINES,
  heightPx,
  fill,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  lineCount: number
  minLines?: number
  heightPx?: number
  fill?: boolean
  className?: string
  children: ReactNode
  'aria-label': string
}) {
  const n = Math.max(minLines, lineCount)
  const height = fill ? undefined : (heightPx ?? n * PLAIN_TEXT_EDITOR_LINE_H + PAD_Y)
  return (
    <div
      className={cn(plainTextEditorShellClass, 'flex', fill && 'min-h-0 flex-1 self-stretch overflow-auto', className)}
      style={height != null ? { height } : undefined}
      role="group"
      aria-label={ariaLabel}
    >
      <div aria-hidden className={plainTextEditorGutterClass}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="block h-5 tabular-nums leading-5">
            {i + 1}
          </span>
        ))}
      </div>
      <div className={cn('min-w-0 flex-1 overflow-x-auto py-1.5 pr-2 pl-2', fill && 'min-h-0')}>{children}</div>
    </div>
  )
}
