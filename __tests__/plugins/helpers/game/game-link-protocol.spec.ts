/**
 * @jest-environment node
 */
import { encodeGameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'

/** Protocol encode/decode: used by plugin game-link; edge-input cases */
describe('game-link-protocol (plugins dependency)', () => {
  it('round-trips hello', () => {
    const msg = { type: 'hello' as const, role: 'game' as const, gameId: 'g1' }
    expect(parseGameLinkMessage(encodeGameLinkMessage(msg))).toEqual(msg)
  })

  it('bad JSON / missing type → null', () => {
    expect(parseGameLinkMessage('{')).toBeNull()
    expect(parseGameLinkMessage('[]')).toBeNull()
    expect(parseGameLinkMessage('{"foo":1}')).toBeNull()
    expect(parseGameLinkMessage('')).toBeNull()
  })
})
