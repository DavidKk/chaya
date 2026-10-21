/**
 * Small Ruby Marshal reader/writer for RPG Maker VX/VX Ace data files.
 * It intentionally keeps Ruby objects as tagged values so class names and
 * instance variables survive a read/write round trip.
 */

export type RubyValue =
  | null
  | boolean
  | number
  | RubyString
  | RubySymbol
  | RubyFloat
  | RubyBignum
  | RubyArray
  | RubyHash
  | RubyObject
  | RubyUserDefined
  | RubyUserMarshal
  | RubyUserClass
  | RubyStruct
  | RubyRegexp

export type RubyString = { kind: 'string'; value: string; ivars?: RubyHash; bytes?: Uint8Array }
export type RubySymbol = { kind: 'symbol'; value: string }
export type RubyFloat = { kind: 'float'; value: string; bytes?: Uint8Array }
export type RubyBignum = { kind: 'bignum'; sign: '+' | '-'; bytes: Uint8Array }
export type RubyArray = { kind: 'array'; items: RubyValue[]; ivars?: RubyHash }
export type RubyHash = { kind: 'hash'; pairs: Array<{ key: RubyValue; value: RubyValue }>; defaultValue?: RubyValue; ivars?: RubyHash }
export type RubyObject = { kind: 'object'; className: string; ivars: RubyHash }
export type RubyUserDefined = { kind: 'user-defined'; className: string; data: Uint8Array; ivars?: RubyHash }
export type RubyRegexp = { kind: 'regexp'; data: Uint8Array; options: number; ivars?: RubyHash }
export type RubyUserMarshal = { kind: 'user-marshal'; className: string; value: RubyValue }
export type RubyUserClass = { kind: 'user-class'; className: string; value: RubyValue }
export type RubyStruct = { kind: 'struct'; className: string; members: Array<{ key: RubySymbol; value: RubyValue }> }

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
    if (first >= 128 && first <= 250) return first - 251

    if (first >= 1 && first <= 4) {
      let value = 0
      for (let i = 0; i < first; i += 1) value += this.readByte()! * 2 ** (8 * i)
      return value
    }

    const length = 256 - first
    assert(length <= 8, 'integer is too large')
    let value = 0
    for (let i = 0; i < length; i += 1) value += this.readByte()! * 2 ** (8 * i)
    return value - 2 ** (8 * length)
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
      if (value.kind === 'string' || value.kind === 'array' || value.kind === 'hash' || value.kind === 'user-defined' || value.kind === 'regexp') value.ivars = ivars
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
        const bytes = this.readBytes(this.readIntegerBody()).slice()
        const value: RubyString = { kind: 'string', value: decodeUtf8(bytes) }
        // Preserve opaque strings (e.g. compressed RGSS scripts) without making
        // raw bytes part of the public, JSON-facing representation.
        Object.defineProperty(value, 'bytes', { value: bytes, writable: true })
        this.objects.push(value)
        return value
      }
      case 'f': {
        const length = this.readIntegerBody()
        const bytes = this.readBytes(length).slice()
        const value: RubyFloat = { kind: 'float', value: decodeUtf8(bytes) }
        // Ruby 1.8 may append binary mantissa bytes after a NUL separator.
        Object.defineProperty(value, 'bytes', { value: bytes, writable: true })
        this.objects.push(value)
        return value
      }
      case '/': {
        const value: RubyRegexp = { kind: 'regexp', data: this.readBytes(this.readIntegerBody()).slice(), options: this.readByte() }
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
      case 'l': {
        const sign = String.fromCharCode(this.readByte())
        assert(sign === '+' || sign === '-', 'invalid bignum sign')
        const count = this.readIntegerBody()
        const value: RubyBignum = { kind: 'bignum', sign, bytes: this.readBytes(count * 2).slice() }
        this.objects.push(value)
        return value
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
      case 'u': {
        const className = this.readSymbol().value
        const length = this.readIntegerBody()
        const result: RubyUserDefined = { kind: 'user-defined', className, data: this.readBytes(length).slice() }
        this.objects.push(result)
        return result
      }
      case 'U': {
        const className = this.readSymbol().value
        const result: RubyUserMarshal = { kind: 'user-marshal', className, value: null }
        this.objects.push(result)
        result.value = this.readValue()
        return result
      }
      case 'C': {
        const className = this.readSymbol().value
        const index = this.objects.length
        const result: RubyUserClass = { kind: 'user-class', className, value: null }
        result.value = this.readValue()
        this.objects[index] = result
        return result
      }
      case 'S': {
        const className = this.readSymbol().value
        const count = this.readIntegerBody()
        const result: RubyStruct = { kind: 'struct', className, members: [] }
        this.objects.push(result)
        for (let i = 0; i < count; i += 1) result.members.push({ key: this.readSymbol(), value: this.readValue() })
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
  if (value < 0 && value > -124) return [value + 251]
  const negative = value < 0
  let length = 1
  if (negative) {
    while (value < -(2 ** (8 * length)) && length < 8) length += 1
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
  private readonly objects = new Map<object, number>()

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
    this.byte(0x22)
    const data = value.bytes && decodeUtf8(value.bytes) === value.value ? value.bytes : encodeUtf8(value.value)
    this.integer(data.length)
    this.bytes(data)
  }

  private writeIvars(value: RubyValue, ivars: RubyHash) {
    this.byte(0x49)
    this.writePayload(value)
    this.integer(ivars.pairs.length)
    for (const pair of ivars.pairs) {
      const key = symbolName(pair.key)
      this.writeSymbol(key)
      this.writeValue(pair.value)
    }
  }

  private writeValue(value: RubyValue) {
    if (value === null) return this.byte(0x30)
    if (value === true) return this.byte(0x54)
    if (value === false) return this.byte(0x46)
    if (typeof value === 'number') {
      this.byte(0x69)
      return this.integer(value)
    }
    const linkable = value && typeof value === 'object' && value.kind !== 'symbol'
    if (linkable) {
      const object = value as object
      const existing = this.objects.get(object)
      if (existing != null) {
        this.byte(0x40)
        this.integer(existing)
        return
      }
      this.objects.set(object, this.objects.size)
    }
    if (value.kind === 'string') return value.ivars ? this.writeIvars(value, value.ivars) : this.writeString(value)
    if (value.kind === 'symbol') return this.writeSymbol(value.value)
    if (value.kind === 'float') {
      this.byte(0x66)
      const data = value.bytes && decodeUtf8(value.bytes) === value.value ? value.bytes : encodeUtf8(value.value)
      this.integer(data.length)
      this.bytes(data)
      return
    }
    if (value.kind === 'bignum') {
      this.byte(0x6c)
      this.byte(value.sign.charCodeAt(0))
      this.integer(value.bytes.length / 2)
      this.bytes(value.bytes)
      return
    }
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
    if (value.kind === 'user-defined') {
      if (value.ivars) return this.writeIvars(value, value.ivars)
      this.byte(0x75)
      this.writeSymbol(value.className)
      this.integer(value.data.length)
      this.bytes(value.data)
      return
    }
    if (value.kind === 'regexp') {
      if (value.ivars) return this.writeIvars(value, value.ivars)
      this.byte(0x2f)
      this.integer(value.data.length)
      this.bytes(value.data)
      this.byte(value.options)
      return
    }
    if (value.kind === 'user-marshal' || value.kind === 'user-class') {
      this.byte(value.kind === 'user-marshal' ? 0x55 : 0x43)
      this.writeSymbol(value.className)
      if (value.kind === 'user-class') this.writePayload(value.value)
      else this.writeValue(value.value)
      return
    }
    if (value.kind === 'struct') {
      this.byte(0x53)
      this.writeSymbol(value.className)
      this.integer(value.members.length)
      for (const member of value.members) {
        this.writeSymbol(member.key.value)
        this.writeValue(member.value)
      }
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

  /** Writes the payload after an `I` wrapper without registering the same object again. */
  private writePayload(value: RubyValue) {
    if (!value || typeof value !== 'object') return this.writeValue(value)
    if (value.kind === 'string') return this.writeString(value)
    if (value.kind === 'regexp') {
      this.byte(0x2f)
      this.integer(value.data.length)
      this.bytes(value.data)
      this.byte(value.options)
      return
    }
    if (value.kind === 'user-defined') {
      this.byte(0x75)
      this.writeSymbol(value.className)
      this.integer(value.data.length)
      this.bytes(value.data)
      return
    }
    if (value.kind === 'array') {
      this.byte(0x5b)
      this.integer(value.items.length)
      for (const item of value.items) this.writeValue(item)
      return
    }
    if (value.kind === 'hash') {
      this.byte(value.defaultValue === undefined ? 0x7b : 0x7d)
      this.integer(value.pairs.length)
      for (const pair of value.pairs) {
        this.writeValue(pair.key)
        this.writeValue(pair.value)
      }
      if (value.defaultValue !== undefined) this.writeValue(value.defaultValue)
      return
    }
    this.writeValue(value)
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
  if (value.kind === 'float') return Number(value.value.split('\0', 1)[0])
  if (value.kind === 'regexp') return { __rubyRegexp: Array.from(value.data), options: value.options }
  if (value.kind === 'bignum') {
    let integer = BigInt(0)
    for (let i = value.bytes.length - 1; i >= 0; i -= 1) integer = integer * BigInt(256) + BigInt(value.bytes[i]!)
    return (value.sign === '+' ? integer : -integer).toString()
  }
  if (value.kind === 'user-defined') return { __rubyClass: value.className, data: Array.from(value.data) }
  if (value.kind === 'user-marshal' || value.kind === 'user-class') return { __rubyClass: value.className, value: plainValue(value.value) }
  if (value.kind === 'struct') {
    const out: Record<string, unknown> = { __rubyClass: value.className }
    for (const member of value.members) out[member.key.value] = plainValue(member.value)
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
