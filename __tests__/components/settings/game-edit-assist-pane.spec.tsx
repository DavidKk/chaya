/** @jest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server'

import { AssistShell } from '@/components/input-assistance/AssistShell'
import { GameEditAgentSettingsPane } from '@/components/settings/GameEditAgentSettingsPane'

jest.mock('next/navigation', () => ({ usePathname: () => '/assist/hotkeys' }))

function navLabels(html: string): string[] {
  const nav = new DOMParser().parseFromString(html, 'text/html').querySelector('nav')
  return [...(nav?.querySelectorAll('[aria-label]') ?? [])].map((node) => node.getAttribute('aria-label')!).filter((label) => label !== nav?.getAttribute('aria-label'))
}

it('shows the same assist sections in the game overlay as on the web console', () => {
  const overlay = renderToStaticMarkup(<GameEditAgentSettingsPane request={async () => new Response('{}')} hotkeys={<p>hotkeys-slot</p>} />)
  const web = renderToStaticMarkup(
    <AssistShell>
      <p />
    </AssistShell>
  )

  expect(navLabels(overlay)).toEqual(navLabels(web))
  expect(navLabels(overlay)).toHaveLength(8)
  expect(overlay).toContain('hotkeys-slot')
})
