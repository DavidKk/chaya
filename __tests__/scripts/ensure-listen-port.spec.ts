import { killCommandForPort, parseLsofListeners } from '../../scripts/ensure-listen-port.cjs'

describe('ensure-listen-port', () => {
  it('parses lsof -Fpc listeners and skips self/parent pids', () => {
    expect(
      parseLsofListeners(['p3813', 'cnode', 'p9900', 'cnext', 'p12', 'cself'].join('\n'), {
        selfPid: 12,
        parentPid: 1,
      })
    ).toEqual([
      { pid: 3813, command: 'node' },
      { pid: 9900, command: 'next' },
    ])
  })

  it('builds a portable kill hint for the listen port', () => {
    expect(killCommandForPort(3000)).toBe('kill $(lsof -t -iTCP:3000 -sTCP:LISTEN)')
  })
})
