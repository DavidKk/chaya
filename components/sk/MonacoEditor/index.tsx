'use client'

import type { EditorProps } from '@monaco-editor/react'
import dynamic from 'next/dynamic'

/** Async Monaco shell — keeps `monaco-editor` out of the initial page chunk. Same pattern as ticket-janitor. */
export const MonacoEditor = dynamic(() => import('./MonacoEditorImpl'), {
  ssr: false,
})

export type MonacoEditorProps = EditorProps
