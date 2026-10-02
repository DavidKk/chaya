import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { codeToHtml } from 'shiki'

import { RemoteScriptView } from '@/components/RemoteScriptView'
import { isRemoteScriptName, REMOTE_SCRIPT_NAMES } from '@/lib/remote-scripts/command'
import { getRemoteScriptSource } from '@/lib/remote-scripts/registry'
import packageJson from '@/package.json'

export const dynamicParams = false

export function generateStaticParams() {
  return REMOTE_SCRIPT_NAMES.map((name) => ({ name }))
}

export async function generateMetadata({ params }: PageProps<'/sh/[name]/view'>): Promise<Metadata> {
  const { name } = await params
  return { title: `${name} · Chaya`, robots: { index: false } }
}

function githubUrl() {
  const repository = (packageJson as { repository?: string | { url?: string } }).repository
  const raw = typeof repository === 'string' ? repository : repository?.url
  return (raw || 'https://github.com').replace(/^git\+/, '').replace(/\.git$/, '')
}

export default async function RemoteScriptPage({ params }: PageProps<'/sh/[name]/view'>) {
  const { name } = await params
  const source = getRemoteScriptSource(name)
  if (!source || !isRemoteScriptName(name)) notFound()

  const html = await codeToHtml(source.trimEnd(), { lang: 'bash', theme: 'github-dark-default' })
  return <RemoteScriptView name={name} html={html} lineCount={source.trimEnd().split('\n').length} githubUrl={githubUrl()} />
}
