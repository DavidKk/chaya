import { createChunkReceiver, type LinkChunkPacket, sendChunked } from '@/lib/runtime/link-chunks'

async function collect(message: unknown) {
  const packets: LinkChunkPacket[] = []
  await sendChunked((packet) => {
    packets.push(packet)
  }, message)
  return packets
}

describe('link-chunks', () => {
  it('splits a large message into small packets and reassembles it', async () => {
    const message = { type: 'edit.events', data: { text: '公共事件'.repeat(5_000) } }
    const packets = await collect(message)
    expect(packets.length).toBeGreaterThan(1)
    for (const packet of packets) expect(JSON.stringify(packet).length).toBeLessThan(16 * 1024)

    const received: unknown[] = []
    const receiver = createChunkReceiver((msg) => received.push(msg))
    for (const packet of packets) receiver.receive(packet)
    expect(received).toEqual([message])
  })

  it('sends a small message as a single packet', async () => {
    const packets = await collect({ type: 'edit.events.request' })
    expect(packets).toHaveLength(1)
    expect(packets[0]).toMatchObject({ index: 0, total: 1 })
  })

  it('drops out-of-order packets and invalid payloads', async () => {
    const packets = await collect({ type: 'x', data: 'a'.repeat(10_000) })
    const received: unknown[] = []
    const receiver = createChunkReceiver((msg) => received.push(msg))
    receiver.receive(packets[1])
    receiver.receive(packets[0])
    receiver.receive(packets[2])
    receiver.receive(packets[1])
    expect(received).toEqual([])

    receiver.receive({ type: 'link.chunk', id: 'bad', index: 0, total: 1, chunk: '"not an object"' })
    expect(received).toEqual([])
    receiver.dispose()
  })
})
