/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { CacheTestView } from '@/components/translate/CacheTestView'
import { traceTranslationCache } from '@/lib/translate/cache-match-trace'
import { planSentenceTranslation, renderSentencePlan } from '@/lib/translate/sentence-plan'

const send = jest.fn()
const push = jest.fn()
const replace = jest.fn()
let query = new URLSearchParams()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => query }))
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => send }))
jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: () => ({ roomId: 'game-a', browserMode: false }) }))
jest.mock('@/components/i18n/LocaleProvider', () => ({ useLocaleCode: () => 'zh', useT: () => (key: string) => key }))
jest.mock('@/components/PanelHeadEnd', () => ({
  PanelHeadEnd: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelHeadStart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/sk', () => ({
  Button: ({ children, onClick, loading, disabled }: { children: ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean }) => (
    <button onClick={onClick} disabled={loading || disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  PlainTextEditor: ({ value, onChange, highlights, 'aria-label': label }: { value: string; onChange: (v: string) => void; highlights?: unknown; 'aria-label': string }) => (
    <textarea aria-label={label} data-highlights={JSON.stringify(highlights)} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  Select: ({
    value,
    onChange,
    options,
    'aria-label': label,
  }: {
    value: string
    onChange: (v: string) => void
    options: Array<{ value: string; label: string; disabled?: boolean }>
    'aria-label': string
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  send.mockReset()
  push.mockReset()
  replace.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<CacheTestView />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const button = () => [...host.querySelectorAll('button')].find((b) => b.textContent === '测试缓存')!
const fillSource = async (text: string) => {
  await act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const result = {
  query: { text: 'hello' },
  ruleVersion: 5,
  corpusVersion: '1',
  structure: { units: [], layout: [], diagnostics: [] },
  plan: { status: 'miss', src: 'hello', matches: [], gaps: [{ id: '0:5', start: 0, end: 5, text: 'hello' }], zh: null, coverage: 0, ambiguous: false },
  preview: 'hello',
  candidateCount: 0,
  diagnostics: [],
}
it('starts with an empty source', () => {
  expect(host.querySelector('textarea')!.value).toBe('')
})
it('renders every path and unused split previews after a full hit', async () => {
  const text = '「First.Second.」'
  const rows = [
    { id: 'parent', revision: 1, src: text, zh: '整段译文' },
    { id: 'first', revision: 1, src: 'First.', zh: '第一。' },
    { id: 'second', revision: 1, src: 'Second.', zh: '第二。' },
  ]
  const plan = planSentenceTranslation(text, rows)
  await fillSource(text)
  send.mockResolvedValue({ ok: true, json: async () => ({ ...result, query: { text }, plan, preview: '整段译文', trace: traceTranslationCache(text, rows, plan) }) })
  await act(async () => button().click())
  const trace = host.querySelector('section[aria-label="全部匹配路径"]')!
  expect(trace.querySelectorAll('ol > li')).toHaveLength(14)
  expect(trace.textContent).toContain('实际结果采用')
  expect(trace.textContent).toContain('备选路径')
  expect(trace.textContent).toContain('第一。第二。')
  expect(trace.textContent).toContain('没有满足条件的完整句原译对齐')
  const structure = host.querySelector('section[aria-label="结构拆分"]')!
  expect(structure.querySelectorAll('ol > li')).toHaveLength(2)
  expect(structure.textContent).toContain('「First.')
  expect(structure.textContent).toContain('Second.」')
  expect(structure.textContent).not.toContain('未识别到可拆分的结构边界')
  expect(send).toHaveBeenCalledTimes(1)
})

it('shows both sentence segments even when neither matches a cache record', async () => {
  const text = '「First.Changed second」'
  await fillSource(text)
  send.mockResolvedValue({ ok: true, json: async () => ({ ...result, query: { text, from: 'en', to: 'zh' } }) })
  await act(async () => button().click())
  const structure = host.querySelector('section[aria-label="结构拆分"]')!
  expect(structure.querySelectorAll('ol > li')).toHaveLength(2)
  expect(structure.textContent).toContain('分句 1')
  expect(structure.textContent).toContain('分句 2')
})

it('shows the retained whole text when splitting is disabled', async () => {
  const text = '「First.Second.」'
  await fillSource(text)
  send.mockResolvedValue({ ok: true, json: async () => ({ ...result, query: { text, structure: { mode: 'disabled' } } }) })
  await act(async () => button().click())
  const structure = host.querySelector('section[aria-label="结构拆分"]')!
  expect(structure.querySelectorAll('ol > li')).toHaveLength(1)
  expect(structure.textContent).toContain('整段')
  expect(structure.textContent).toContain(text)
})

it('keeps output highlights aligned after an untranslated literal newline', async () => {
  const text = '「First.\\nChanged」'
  const plan = planSentenceTranslation(text, [{ id: 'first', revision: 1, src: '「First.', zh: '「第一。' }])
  const preview = renderSentencePlan(plan)
  await fillSource(text)
  send.mockResolvedValue({ ok: true, json: async () => ({ ...result, query: { text }, plan, preview }) })
  await act(async () => button().click())
  const output = host.querySelector('textarea[aria-label="译文"]') as HTMLTextAreaElement
  const highlights = JSON.parse(output.dataset.highlights!) as Array<{ start: number; end: number }>
  expect(output.value).toBe('「第一。\\nChanged」')
  expect(highlights.at(-1)?.end).toBe(output.value.length)
  expect(output.value.slice(highlights.at(-1)!.start, highlights.at(-1)!.end)).toBe(plan.gaps.at(-1)!.text)
})
it('sends a read-only test and presents misses without calling translation', async () => {
  await fillSource('hello')
  send.mockResolvedValue({ ok: true, json: async () => result })
  await act(async () => button().click())
  expect(send).toHaveBeenCalledWith('/api/translate-cache/test', expect.objectContaining({ method: 'POST' }))
  expect(host.textContent).toContain('未命中')
  expect(host.textContent).toContain('结构拆分')
  expect(host.textContent).not.toContain('拼接预览')
  expect(send).toHaveBeenCalledTimes(1)
  expect(replace).toHaveBeenCalledWith('/translate/test?q=hello', { scroll: false })
})
it('prevents duplicate clicks and discards results when the input changes', async () => {
  await fillSource('hello')
  let finish!: (v: unknown) => void
  send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  await act(async () => {
    button().click()
    button().click()
  })
  expect(send).toHaveBeenCalledTimes(1)
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('取消'))).toBe(false)
  await fillSource('new query')
  await act(async () => finish({ ok: true, json: async () => result }))
  expect(host.textContent).not.toContain('结构拆分')
  expect(host.querySelector('textarea')!.value).toBe('new query')
})
it('preserves the draft and restores the test button after a failure', async () => {
  await fillSource('解放条件：①レベル60以上 ②再度VIP特典の仕事をする')
  send.mockRejectedValue(new Error('offline'))
  await act(async () => button().click())
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('offline')
  expect(button().disabled).toBe(false)
  expect(host.querySelector('textarea')!.value).toContain('解放条件')
})

it('returns to the cache list with the original filters', async () => {
  query = new URLSearchParams({ returnTo: '/translate/cache?page=3&q=test' })
  await act(async () => root.render(<CacheTestView />))
  await act(async () => host.querySelector('button')!.click())
  expect(push).toHaveBeenCalledWith('/translate/cache?page=3&q=test')
  query = new URLSearchParams()
})

it('optimizes q parameter on run, stripping trailing newlines and collapsing whitespace', async () => {
  const rawWithNewlines = '解放条件：①レベル60以上          ②再度VIP特典の仕事をする\n\n\n\n\n\n\n\n\n\n'
  const expectedNormalized = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする'
  await fillSource(rawWithNewlines)
  send.mockResolvedValue({ ok: true, json: async () => ({ ...result, query: { text: expectedNormalized } }) })
  await act(async () => button().click())
  expect(send).toHaveBeenCalledWith(
    '/api/translate-cache/test',
    expect.objectContaining({
      body: expect.stringContaining(JSON.stringify(expectedNormalized)),
    })
  )
  const replaceUrl = replace.mock.calls[replace.mock.calls.length - 1][0] as string
  expect(replaceUrl).toBe('/translate/test?' + new URLSearchParams({ q: expectedNormalized }).toString())
  expect(replaceUrl).not.toContain('%0A')
  expect(host.querySelector('textarea')!.value).toBe(expectedNormalized)
})

it('optimizes URL q parameter and normalizes input when mounted with raw newlines', async () => {
  const raw = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする\n\n\n\n'
  const clean = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする'
  query = new URLSearchParams({ q: raw })
  await act(async () => root.render(<CacheTestView />))
  expect(host.querySelector('textarea')!.value).toBe(clean)
  expect(replace).toHaveBeenCalledWith('/translate/test?' + new URLSearchParams({ q: clean }).toString(), { scroll: false })
  query = new URLSearchParams()
})

it('preserves existing test results when extra whitespace or newlines are typed into textarea', async () => {
  const clean = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする'
  await fillSource(clean)
  send.mockResolvedValue({ ok: true, json: async () => result })
  await act(async () => button().click())
  expect(host.textContent).toContain('未命中')

  // Adding trailing spaces or fullwidth spaces normalizes to the same query
  await fillSource(clean + '   \u3000\u3000  \n\n')
  expect(host.textContent).toContain('未命中')
})
