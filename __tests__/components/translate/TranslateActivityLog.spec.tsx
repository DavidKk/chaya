import { renderToStaticMarkup } from 'react-dom/server'

import { TranslateActivityLog } from '@/components/translate/TranslateActivityLog'
import { zh } from '@/lib/i18n/messages/zh'
import { translate } from '@/lib/i18n/t'

jest.mock('@/components/i18n/LocaleProvider', () => ({
  useT: () => (key: Parameters<typeof translate>[1], params: Parameters<typeof translate>[2]) => translate(zh, key, params),
}))
jest.mock('@/components/sk', () => ({ TruncateText: ({ text }: { text: string }) => <span>{text}</span> }))
jest.mock('@/components/logs/FollowScrollLogList', () => ({
  FollowScrollLogList: ({ entries }: { entries: Array<{ id: number; text: string }> }) => entries.map((entry) => <p key={entry.id}>{entry.text}</p>),
}))

it('distinguishes a real Agent request from a small timed cache result window', () => {
  const html = renderToStaticMarkup(
    <TranslateActivityLog
      entries={[
        { id: 1, at: 0, level: 'info', text: 'request', request: { items: 333, chars: 2997 } },
        {
          id: 2,
          at: 1,
          level: 'ok',
          text: 'result',
          batch: {
            batch: 12,
            success: 10,
            total: 10,
            failed: 0,
            chars: 206,
            cacheHits: 10,
            submittedSources: [],
            finalSources: ['cache'],
            cacheUnavailable: false,
            windowReason: 'timeout',
          },
        },
        { id: 3, at: 2, level: 'info', text: 'legacy log' },
        { id: 4, at: 3, level: 'info', text: 'Apple request', request: { engine: 'apple', items: 20, chars: 1000 } },
        { id: 5, at: 4, level: 'warn', text: 'Cache scan failed: Worker timed out' },
      ]}
    />
  )
  expect(html).toContain('[Agent] 请求已提交：333 条（2997 字符）')
  expect(html).toContain('10/10 条（206 字符）完成')
  expect(html).not.toContain('结果窗口')
  expect(html).toContain('[Apple] 请求已提交：20 条（1000 字符）')
  expect(html).toContain('缓存扫描暂不可用，继续使用翻译引擎：Worker timed out')
  expect(html).toContain('legacy log')
})
