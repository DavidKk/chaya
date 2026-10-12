import { parsePlayerCard, playerCardAnswer } from '@/lib/game-agent/player-card'

describe('parsePlayerCard', () => {
  it('normalizes confirm cards to yes / no and keeps custom labels', () => {
    expect(parsePlayerCard({ kind: 'confirm', text: ' 要我帮你吗？ ', options: ['好呀'] })).toEqual({
      kind: 'confirm',
      text: '要我帮你吗？',
      options: [
        { id: 'yes', label: '好呀' },
        { id: 'no', label: '' },
      ],
    })
  })

  it('needs 2–4 distinct options for a choice card', () => {
    expect(parsePlayerCard({ kind: 'choice', text: '去哪？', options: ['北边'] })).toBeNull()
    const card = parsePlayerCard({ kind: 'choice', text: '去哪？', options: ['北', { id: 'south', label: '南' }, '北', '东', '西', '中'] })
    expect(card?.options).toEqual([
      { id: '北', label: '北' },
      { id: 'south', label: '南' },
      { id: '东', label: '东' },
      { id: '西', label: '西' },
    ])
  })

  it('drops options and unknown tones on notices, and rejects empty or unknown cards', () => {
    expect(parsePlayerCard({ kind: 'notice', text: '存档了', tone: 'loud', options: ['x'] })).toEqual({ kind: 'notice', text: '存档了', options: [] })
    expect(parsePlayerCard({ kind: 'notice', text: '  ' })).toBeNull()
    expect(parsePlayerCard({ kind: 'modal', text: 'hi' })).toBeNull()
    expect(parsePlayerCard(null)).toBeNull()
  })
})

describe('playerCardAnswer', () => {
  const card = parsePlayerCard({
    kind: 'choice',
    text: '去哪？',
    options: [
      { id: 'n', label: '北' },
      { id: 's', label: '南' },
    ],
  })!

  it('maps a clicked option id to its label', () => {
    expect(playerCardAnswer(card, 's')).toEqual({ answered: true, choice: 's', label: '南' })
  })

  it('passes typed text through as a free reply', () => {
    expect(playerCardAnswer(card, '都不去')).toEqual({ answered: true, reply: '都不去' })
  })
})
