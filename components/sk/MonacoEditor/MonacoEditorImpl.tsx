'use client'

import Editor, { loader } from '@monaco-editor/react'

/** Same loader pattern as ticket-janitor (`components/MonacoEditor/MonacoEditorImpl.tsx`). */
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs' } })

export default Editor
