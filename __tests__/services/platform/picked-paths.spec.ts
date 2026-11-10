import { pickedPaths, splitPickedPaths } from '@/services/platform/pick/shared'

it('keeps one path per line and drops blanks', () => {
  expect(splitPickedPaths('/Games/A/\n\n/Games/B\n/Games/A')).toEqual(['/Games/A', '/Games/B'])
  expect(pickedPaths('C:\\Games\\One\\\r\nC:\\Games\\Two')).toEqual({
    path: 'C:\\Games\\One',
    paths: ['C:\\Games\\One', 'C:\\Games\\Two'],
  })
  expect(pickedPaths('   ')).toBeNull()
})
