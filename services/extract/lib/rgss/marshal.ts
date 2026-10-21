/**
 * Small Ruby Marshal reader/writer for RPG Maker VX/VX Ace data files.
 * It intentionally keeps Ruby objects as tagged values so class names and
 * instance variables survive a read/write round trip.
 */

export type RubyValue = null | boolean | number | RubyString | RubySymbol | RubyArray | RubyHash | RubyObject

export type RubyString = { kind: 'string'; value: string; ivars?: RubyHash }
export type RubySymbol = { kind: 'symbol'; value: string }
export type RubyArray = { kind: 'array'; items: RubyValue[]; ivars?: RubyHash }
export type RubyHash = { kind: 'hash'; pairs: Array<{ key: RubyValue; value: RubyValue }>; defaultValue?: RubyValue; ivars?: RubyHash }
export type RubyObject = { kind: 'object'; className: string; ivars: RubyHash }

const HEADER_MAJOR = 4
const HEADER_MINOR = 8

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Ruby Marshal data: ${message}`)
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

class Reader {
  private offset = 0
  readonly symbols: string[] = []
  readonly objects: RubyValue[] = []

  constructor(private readonly bytes: Uint8Array) {}

  private readByte(): number {
    assert(this.offset < this.bytes.length, 'unexpected end of input')
    return this.bytes[this.offset++]!
  }

  private readBytes(length: number): Uint8Array {
    assert(length >= 0 && this.offset + length <= this.bytes.length, 'truncated payload')
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  private readIntegerBody(): number {
    const first = this.readByte()
    if (first === 0) return 0
    if (first >= 5 && first <= 127) return first - 5
    if (first >= 246 && first <= 250) return first - 251

    if (first >= 1 && first <= 4) {
      let value = 0
      for (let i = 0; i < first; i += 1) value += this.readByte()! * 2 ** (8 * i)
      return value
    }

    const length = 256 - first
    assert(length <= 8, 'integer is too large')
    let value = 0
    for (let i = 0; i < length; i += 1) value += this.readByte()! * 2 ** (8 * i)
    const signBit = 2 ** (8 * length - 1)
    return value >= signBit ? value - 2 ** (8 * length) : value
  }

  private readSymbol(): RubySymbol {
    const tag = String.fromCharCode(this.readByte())
    if (tag === ';') {
      const index = this.readIntegerBody()
      assert(index >= 0 && index < this.symbols.length, 'symbol link out of range')
      return { kind: 'symbol', value: this.symbols[index]! }
    }
    assert(tag === ':', `expected symbol, got ${JSON.stringify(tag)}`)
    const value = decodeUtf8(this.readBytes(this.readIntegerBody()))
    this.symbols.push(value)
    return { kind: 'symbol', value }
  }

  private readIvars(value: RubyValue): RubyValue {
    const count = this.readIntegerBody()
    const pairs: Array<{ key: RubyValue; value: RubyValue }> = []
    for (let i = 0; i < count; i += 1) pairs.push({ key: this.readSymbol(), value: this.readValue() })
    const ivars: RubyHash = { kind: 'hash', pairs }
    if (value && typeof value === 'object' && 'kind' in value) {
      if (value.kind === 'string' || value.kind === 'array' || value.kind === 'hash') value.ivars = ivars
    }
    return value
  }

  readValue(): RubyValue {
    const tag = String.fromCharCode(this.readByte())
    switch (tag) {
      case '0':
        return null
      case 'T':
        return true
      case 'F':
        return false
      case 'i':
        return this.readIntegerBody()
      case '"': {
        const value: RubyString = { kind: 'string', value: decodeUtf8(this.readBytes(this.readIntegerBody())) }
        this.objects.push(value)
        return value
      }
      case ':':
      case ';':
        this.offset -= 1
        return this.readSymbol()
      case '[': {
        const result: RubyArray = { kind: 'array', items: [] }
        this.objects.push(result)
        const count = this.readIntegerBody()
        for (let i = 0; i < count; i += 1) result.items.push(this.readValue())
        return result
      }
      case '{': {
        const result: RubyHash = { kind: 'hash', pairs: [] }
        this.objects.push(result)
        const count = this.readIntegerBody()
        for (let i = 0; i < count; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() })
        return result
      }
      case '}': {
        const result: RubyHash = { kind: 'hash', pairs: [] }
        this.objects.push(result)
        const count = this.readIntegerBody()
        for (let i = 0; i < count; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() })
        result.defaultValue = this.readValue()
        return result
      }
      case 'I':
        return this.readIvars(this.readValue())
      case 'o': {
        const className = this.readSymbol().value
        const count = this.readIntegerBody()
        const result: RubyObject = { kind: 'object', className, ivars: { kind: 'hash', pairs: [] } }
        this.objects.push(result)
        for (let i = 0; i < count; i += 1) result.ivars.pairs.push({ key: this.readSymbol(), value: this.readValue() })
        return result
      }
      case '@': {
        const index = this.readIntegerBody()
        assert(index >= 0 && index < this.objects.length, 'object link out of range')
        return this.objects[index]!
      }
      default:
        throw new Error(`unsupported Ruby Marshal tag ${JSON.stringify(tag)}`)
    }
  }
}

function symbol(value: string): RubySymbol {
  return { kind: 'symbol', value }
}

function symbolName(value: RubyValue): string {
  return value && typeof value === 'object' && value.kind === 'symbol' ? value.value : String(plainValue(value))
}

function integerBody(value: number): number[] {
  if (!Number.isSafeInteger(value)) throw new Error(`Ruby Marshal integer is outside the safe range: ${value}`)
  if (value === 0) return [0]
  if (value > 0 && value < 123) return [value + 5]
  if (value < 0 && value >= -5) return [value + 251]
  const negative = value < 0
  let length = 1
  if (negative) {
    while (value < -(2 ** (8 * length - 1)) && length < 8) length += 1
    let unsigned = 2 ** (8 * length) + value
    const bytes: number[] = []
    for (let i = 0; i < length; i += 1) {
      bytes.push(unsigned & 0xff)
      unsigned = Math.floor(unsigned / 256)
    }
    return [256 - length, ...bytes]
  }
  while (value >= 2 ** (8 * length) && length < 8) length += 1
  let unsigned = value
  const bytes: number[] = []
  for (let i = 0; i < length; i += 1) {
    bytes.push(unsigned & 0xff)
    unsigned = Math.floor(unsigned / 256)
  }
  return [length, ...bytes]
}

class Writer {
  private readonly out: number[] = [HEADER_MAJOR, HEADER_MINOR]
  private readonly symbols = new Map<string, number>()

  private byte(value: number) {
    this.out.push(value & 0xff)
  }

  private bytes(value: Uint8Array) {
    for (const byte of value) this.out.push(byte)
  }

  private integer(value: number) {
    this.bytes(Uint8Array.from(integerBody(value)))
  }

  private writeSymbol(value: string) {
    const existing = this.symbols.get(value)
    if (existing != null) {
      this.byte(0x3b)
      this.integer(existing)
      return
    }
    this.symbols.set(value, this.symbols.size)
    this.byte(0x3a)
    const data = encodeUtf8(value)
    this.integer(data.length)
    this.bytes(data)
  }

  private writeString(value: RubyString) {
    if (value.ivars) return this.writeIvars(value, value.ivars)
    this.byte(0x22)
    const data = encodeUtf8(value.value)
    this.integer(data.length)
    this.bytes(data)
  }

  private writeIvars(value: RubyValue, ivars: RubyHash) {
    this.byte(0x49)
    if (value && typeof value === 'object' && value.kind !== 'string') this.writeValueWithoutIvars(value)
    else if (value && typeof value === 'object' && value.kind === 'string') this.writeString({ kind: 'string', value: value.value })
    else this.writeValue(value)
    this.integer(ivars.pairs.length)
    for (const pair of ivars.pairs) {
      const key = symbolName(pair.key)
      this.writeSymbol(key)
      this.writeValue(pair.value)
    }
  }

  private writeValueWithoutIvars(value: RubyValue) {
    if (value && typeof value === 'object' && 'ivars' in value) {
      const copy = { ...value }
      delete (copy as { ivars?: RubyHash }).ivars
      this.writeValue(copy as RubyValue)
      return
    }
    this.writeValue(value)
  }

  private writeValue(value: RubyValue) {
    if (value === null) return this.byte(0x30)
    if (value === true) return this.byte(0x54)
    if (value === false) return this.byte(0x46)
    if (typeof value === 'number') {
      this.byte(0x69)
      return this.integer(value)
    }
    if (value.kind === 'string') return this.writeString(value)
    if (value.kind === 'symbol') return this.writeSymbol(value.value)
    if (value.kind === 'array') {
      if (value.ivars) return this.writeIvars(value, value.ivars)
      this.byte(0x5b)
      this.integer(value.items.length)
      for (const item of value.items) this.writeValue(item)
      return
    }
    if (value.kind === 'hash') {
      if (value.ivars) {
        this.writeIvars(value, value.ivars)
        return
      }
      this.byte(value.defaultValue === undefined ? 0x7b : 0x7d)
      this.integer(value.pairs.length)
      for (const pair of value.pairs) {
        this.writeValue(pair.key)
        this.writeValue(pair.value)
      }
      if (value.defaultValue !== undefined) this.writeValue(value.defaultValue)
      return
    }
    this.byte(0x6f)
    this.writeSymbol(value.className)
    this.integer(value.ivars.pairs.length)
    for (const pair of value.ivars.pairs) {
      const key = symbolName(pair.key)
      this.writeSymbol(key)
      this.writeValue(pair.value)
    }
  }

  finish(value: RubyValue): Uint8Array {
    this.writeValue(value)
    return Uint8Array.from(this.out)
  }
}

function plainValue(value: RubyValue): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (value.kind === 'string' || value.kind === 'symbol') return value.value
  if (value.kind === 'array') return value.items.map(plainValue)
  if (value.kind === 'hash') {
    const out: Record<string, unknown> = {}
    for (const pair of value.pairs) out[String(plainValue(pair.key))] = plainValue(pair.value)
    return out
  }
  const out: Record<string, unknown> = {}
  for (const pair of value.ivars.pairs) out[String(plainValue(pair.key)).replace(/^@/, '')] = plainValue(pair.value)
  return out
}

export function parseRubyMarshal(bytes: Uint8Array): RubyValue {
  if (bytes.length < 2 || bytes[0] !== HEADER_MAJOR || bytes[1] !== HEADER_MINOR) throw new Error('Not a Ruby Marshal 4.8 file')
  return new Reader(bytes.subarray(2)).readValue()
}

export function writeRubyMarshal(value: RubyValue): Uint8Array {
  return new Writer().finish(value)
}

export function rubyToPlain(value: RubyValue): unknown {
  return plainValue(value)
}

export function rubyString(value: unknown): value is RubyString {
  return Boolean(value && typeof value === 'object' && (value as RubyString).kind === 'string')
}

export function rubyObjectField(value: RubyValue, field: string): RubyValue | undefined {
  if (!value || typeof value !== 'object' || value.kind !== 'object') return undefined
  const pair = value.ivars.pairs.find((item) => symbolName(item.key) === `@${field}`)
  return pair?.value
}

export function setRubyObjectField(value: RubyValue, field: string, next: RubyValue): boolean {
  if (!value || typeof value !== 'object' || value.kind !== 'object') return false
  const key = `@${field}`
  const pair = value.ivars.pairs.find((item) => symbolName(item.key) === key)
  if (pair) pair.value = next
  else value.ivars.pairs.push({ key: symbol(key), value: next })
  return true
}
