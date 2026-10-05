'use client'

import { type FormEvent, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, Modal, Select, TextInput } from '@/components/sk'
import { type DataPath, isValidKey, parseDraft, type PrimitiveValue, type ValueType } from '@/lib/game/save-data'

import type { DataActions } from './useDataActions'

/** What the dialog adds: an array value (at `index`), an object field, an item count, or a self switch */
export type StructRequest = { mode: 'array' | 'object' | 'item' | 'selfSwitch'; path: DataPath; ownerOid: number; index?: number }

type Props = {
  request: StructRequest | null
  onClose: () => void
  struct: DataActions['struct']
  portalContainer?: Element | null
}

const TYPES: ValueType[] = ['number', 'string', 'boolean', 'null']
const TYPE_LABEL = { number: 'data.typeNumber', string: 'data.typeString', boolean: 'data.typeBoolean', null: 'data.typeNull' } as const
const LETTERS = ['A', 'B', 'C', 'D']
const POSITIVE_INT = /^[1-9]\d*$/

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Add dialogs for structure changes; the result goes through `struct` (which reloads the level) */
export function StructDialog({ request, onClose, struct, portalContainer }: Props) {
  const t = useT()
  const open = request !== null
  return (
    <Modal
      open={open}
      title={t(request?.mode === 'object' ? 'data.addFieldTitle' : 'data.addItemTitle')}
      onClose={onClose}
      portalContainer={portalContainer}
      panelClassName="max-w-[26rem]"
    >
      {request ? <StructForm key={`${request.mode}:${request.path.join('/')}:${request.index ?? ''}`} request={request} onDone={onClose} struct={struct} /> : null}
    </Modal>
  )
}

function StructForm({ request, onDone, struct }: { request: StructRequest; onDone: () => void; struct: DataActions['struct'] }) {
  const t = useT()
  const { mode, path, ownerOid, index } = request
  const [name, setName] = useState('')
  const [type, setType] = useState<ValueType>(mode === 'selfSwitch' ? 'boolean' : 'number')
  const [raw, setRaw] = useState(mode === 'item' ? '1' : '')
  const [bool, setBool] = useState(true)
  const [mapId, setMapId] = useState('')
  const [eventId, setEventId] = useState('')
  const [letter, setLetter] = useState('A')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const value = (): { ok: true; value: PrimitiveValue } | { ok: false } => {
    if (type === 'boolean') return { ok: true, value: bool }
    if (type === 'null') return { ok: true, value: null }
    const parsed = parseDraft(raw, type)
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    let params: Parameters<DataActions['struct']>[0]
    if (mode === 'item') {
      const count = Number(raw)
      if (!POSITIVE_INT.test(name.trim()) || !Number.isInteger(count) || count < 0) return setError(t('data.err.invalid'))
      params = { path, ownerOid, action: 'addKey', key: name.trim(), valueType: 'number', value: count }
    } else if (mode === 'selfSwitch') {
      if (!POSITIVE_INT.test(mapId.trim()) || !POSITIVE_INT.test(eventId.trim())) return setError(t('data.err.invalid'))
      params = { path, ownerOid, action: 'addKey', key: `${mapId.trim()},${eventId.trim()},${letter}`, valueType: 'boolean', value: bool }
    } else {
      const v = value()
      if (!v.ok) return setError(t('data.invalidNumber'))
      if (mode === 'object') {
        if (!isValidKey(name.trim())) return setError(t('data.err.invalid'))
        params = { path, ownerOid, action: 'addKey', key: name.trim(), valueType: type, value: v.value }
      } else {
        params = { path, ownerOid, action: 'insert', index, valueType: type, value: v.value }
      }
    }
    setBusy(true)
    const ok = await struct(params)
    setBusy(false)
    if (ok) onDone()
  }

  const typeOptions = TYPES.map((v) => ({ value: v, label: t(TYPE_LABEL[v]) }))
  const boolPick = (
    <Select
      value={bool ? 'true' : 'false'}
      options={[
        { value: 'true', label: 'true' },
        { value: 'false', label: 'false' },
      ]}
      onChange={(v) => setBool(v === 'true')}
      aria-label={t('data.fieldValue')}
    />
  )

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
      {mode === 'item' ? (
        <>
          <Field label={t('data.itemPick')}>
            <TextInput value={name} inputMode="numeric" autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('data.itemCount')}>
            <TextInput value={raw} inputMode="numeric" onChange={(e) => setRaw(e.target.value)} />
          </Field>
        </>
      ) : mode === 'selfSwitch' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('data.selfSwitchMap')}>
              <TextInput value={mapId} inputMode="numeric" autoFocus onChange={(e) => setMapId(e.target.value)} />
            </Field>
            <Field label={t('data.selfSwitchEvent')}>
              <TextInput value={eventId} inputMode="numeric" onChange={(e) => setEventId(e.target.value)} />
            </Field>
            <Field label={t('data.selfSwitchLetter')}>
              <Select value={letter} options={LETTERS.map((l) => ({ value: l, label: l }))} onChange={setLetter} aria-label={t('data.selfSwitchLetter')} />
            </Field>
          </div>
          <Field label={t('data.fieldValue')}>{boolPick}</Field>
        </>
      ) : (
        <>
          {mode === 'object' ? (
            <Field label={t('data.fieldName')}>
              <TextInput value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <Field label={t('data.fieldType')}>
            <Select value={type} options={typeOptions} onChange={(v) => setType(v as ValueType)} aria-label={t('data.fieldType')} />
          </Field>
          {type === 'boolean' ? (
            <Field label={t('data.fieldValue')}>{boolPick}</Field>
          ) : type === 'null' ? null : (
            <Field label={t('data.fieldValue')}>
              <TextInput value={raw} inputMode={type === 'number' ? 'decimal' : undefined} autoFocus={mode === 'array'} onChange={(e) => setRaw(e.target.value)} />
            </Field>
          )}
        </>
      )}
      {error ? <p className="m-0 text-xs text-fail">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="accent" loading={busy}>
          {t('data.add')}
        </Button>
      </div>
    </form>
  )
}
