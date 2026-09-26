import './globals.css'

import type { Metadata } from 'next'
import { JetBrains_Mono, Manrope, Outfit } from 'next/font/google'

import { AmbientBackground } from '@/components/AmbientBackground'
import { AppProviders } from '@/components/AppProviders'
import { AppShell } from '@/components/AppShell'
import { ButtonGlow } from '@/components/ButtonGlow'
import { LOCALE_HTML_LANG } from '@/lib/i18n'
import { resolveRequestLocale } from '@/lib/i18n/server'

const display = Outfit({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

const body = Manrope({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Chaya',
  description: '本机 RPG Maker 翻译与游戏管理工具',
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await resolveRequestLocale()

  return (
    <html lang={LOCALE_HTML_LANG[locale]} className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="h-full overflow-hidden">
        <AmbientBackground />
        <ButtonGlow />
        <AppProviders locale={locale}>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  )
}
