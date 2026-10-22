import { createSeedBatchBudget } from '@/services/translate/seed-batch'

it('grows fast batches gradually and bounds their count and character budget', () => {
  const budget = createSeedBatchBudget()
  expect(budget.current()).toEqual({ limit: 12, maxChars: 3000 })
  for (let i = 0; i < 20; i++) budget.observe(100, 0, 12)
  expect(budget.current()).toEqual({ limit: 40, maxChars: 10000 })
  budget.observe(20000, 0, 40)
  expect(budget.current()).toEqual({ limit: 20, maxChars: 5000 })
  for (let i = 0; i < 20; i++) budget.observe(20000, 1, 20)
  expect(budget.current()).toEqual({ limit: 4, maxChars: 500 })
})
it('never increases slices after item failures or empty rounds', () => {
  const budget = createSeedBatchBudget()
  budget.observe(100, 1, 12)
  expect(budget.current()).toEqual({ limit: 9, maxChars: 2250 })
  budget.observe(100, 0, 0)
  expect(budget.current()).toEqual({ limit: 9, maxChars: 2250 })
})
