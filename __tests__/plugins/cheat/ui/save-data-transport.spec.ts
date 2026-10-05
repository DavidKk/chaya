import { createDirectTransport } from '@/plugins/src/cheat/ui/save-data-transport'

const cancelSearch = jest.fn()
const search = jest.fn(() => cancelSearch)

jest.mock('@/plugins/src/cheat/session/save-data', () => ({
  SaveData: {
    onStatus: jest.fn(() => () => undefined),
    status: jest.fn(() => ({ gen: 1, ready: true, undo: null, undoDepth: 0, locks: [], pins: [] })),
    createWatcher: jest.fn(),
    list: jest.fn(),
    read: jest.fn(),
    rows: jest.fn(),
    search: (...args: unknown[]) => search(...args),
    run: jest.fn(),
  },
}))

beforeEach(() => {
  cancelSearch.mockClear()
  search.mockClear()
})

test('cancels active searches when the direct transport is disposed', () => {
  const transport = createDirectTransport()
  transport.search([], 'gold', 'all', jest.fn())

  transport.dispose()

  expect(cancelSearch).toHaveBeenCalledTimes(1)
})
