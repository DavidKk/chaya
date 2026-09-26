import { hookMethod } from '@/plugins/src/helpers/game/method-hook'

test('retires old behavior but retains later plugin wrappers, receiver and arguments', () => {
  const target = {
    prefix: 'game',
    method(suffix: string) {
      return this.prefix + suffix
    },
  }
  const oldEffect = jest.fn()
  const dispose = hookMethod(
    target,
    'method',
    (original) =>
      function (...args) {
        oldEffect()
        return original.apply(this, args)
      }
  )
  const previous = target.method
  target.method = function (suffix) {
    return previous.call(this, suffix) + ':third-party'
  }
  expect(target.method('!')).toBe('game!:third-party')
  dispose()
  oldEffect.mockClear()
  const newEffect = jest.fn()
  const removeNew = hookMethod(
    target,
    'method',
    (original) =>
      function (...args) {
        newEffect()
        return original.apply(this, args)
      }
  )
  expect(target.method('?')).toBe('game?:third-party')
  expect(oldEffect).not.toHaveBeenCalled()
  expect(newEffect).toHaveBeenCalledTimes(1)
  removeNew()
  removeNew()
  expect(target.method('.')).toBe('game.:third-party')
})

test('restores inherited method lookup instead of leaving an own method behind', () => {
  const prototype = { method: () => 'original' }
  const target = Object.create(prototype)
  const dispose = hookMethod(target, 'method', () => () => 'hooked')
  expect(target.method()).toBe('hooked')
  dispose()
  expect(Object.hasOwn(target, 'method')).toBe(false)
  prototype.method = () => 'new original'
  expect(target.method()).toBe('new original')
})
