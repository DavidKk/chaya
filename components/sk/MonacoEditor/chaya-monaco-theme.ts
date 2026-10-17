import type * as Monaco from 'monaco-editor'

/** Compact options aligned with ticket-janitor COMPACT / PLAYGROUND editors. */
export const CHAYA_PLAINTEXT_EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 6, bottom: 6 },
  folding: false,
  glyphMargin: false,
  lineNumbersMinChars: 2,
  lineDecorationsWidth: 8,
  renderLineHighlight: 'line' as const,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  contextmenu: true,
  scrollbar: {
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
    useShadows: false,
  },
}

export const CHAYA_MONACO_THEME = 'chaya-console-dark'

/** Register once; colors follow `styles/chaya-palette.css`. */
export function setupChayaMonacoTheme(monaco: typeof Monaco) {
  monaco.editor.defineTheme(CHAYA_MONACO_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#101826',
      'editor.foreground': '#f0f7ff',
      'editorLineNumber.foreground': '#8aa0bc',
      'editorLineNumber.activeForeground': '#f0f7ff',
      'editor.lineHighlightBackground': '#172234',
      'editor.selectionBackground': '#2ad4ff40',
      'editor.inactiveSelectionBackground': '#2ad4ff22',
      'editorIndentGuide.background': '#f0f7ff14',
      'editorIndentGuide.activeBackground': '#f0f7ff28',
      'editorWidget.background': '#172234',
      'editorWidget.border': '#f0f7ff1f',
      'editorCursor.foreground': '#2ad4ff',
    },
  })
}
