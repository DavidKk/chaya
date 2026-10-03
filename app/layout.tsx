import './globals.css'

import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { AmbientBackground } from '@/components/AmbientBackground'
import { AppProviders } from '@/components/AppProviders'
import { AppShell } from '@/components/AppShell'
import { ButtonGlow } from '@/components/ButtonGlow'
import { LOCALE_HTML_LANG } from '@/lib/i18n'
import { resolveRequestLocale } from '@/lib/i18n/server'

/** Self-hosted fonts so CI / offline builds do not call fonts.google.com */
const display = localFont({
  src: './fonts/outfit-latin-wght-normal.woff2',
  variable: '--font-display',
  weight: '500 700',
  display: 'swap',
})

const body = localFont({
  src: './fonts/manrope-latin-wght-normal.woff2',
  variable: '--font-body',
  weight: '400 700',
  display: 'swap',
})

const mono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-mono',
  weight: '400 500',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Chaya',
  description: '本机 RPG Maker 翻译与游戏管理工具',
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const { locale, preference } = await resolveRequestLocale()
  const Analytics = process.env.VERCEL === '1' ? (await import('@vercel/analytics/next')).Analytics : null

  return (
    <html lang={LOCALE_HTML_LANG[locale]} className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="h-full overflow-hidden">
        <AmbientBackground />
        <ButtonGlow />
        <AppProviders locale={locale} preference={preference}>
          <AppShell>{children}</AppShell>
        </AppProviders>
        {Analytics ? <Analytics /> : null}
      </body>
    </html>
  )
}
