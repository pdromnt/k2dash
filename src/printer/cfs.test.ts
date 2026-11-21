import { describe, expect, it } from 'vitest'
import { parseCfsSnapshot } from './cfs'
import { validateConnectedCfsMappings } from './materialMapping'

const mat = (id = 0, type = 'PETG') => ({ id, type, color: '#ffffff' })
const box = (id: number, data = {}) => ({
  id,
  type: 0,
  state: 0,
  materials: [mat()],
  ...data,
})

describe('native CFS snapshots', () => {
  it('groups all reported unit IDs without renumbering or treating state zero as offline', () => {
    const snapshot = parseCfsSnapshot({
      materialBoxs: [box(4), box(1), box(3), box(2)],
    })!
    expect(snapshot.units.map((unit) => unit.id)).toEqual([1, 2, 3, 4])
    expect(snapshot.units[3]!.slots[0]!.boxId).toBe(4)
  })
  it('keeps an empty connected CFS but separates the external spool', () => {
    const snapshot = parseCfsSnapshot({
      materialBoxs: [
        box(3, { materials: [mat(0, '')] }),
        { id: 0, type: 1, materials: [mat()] },
      ],
    })!
    expect(snapshot.units).toHaveLength(1)
    expect(snapshot.units[0]!.slots[0]!.type).toBe('')
    expect(snapshot.spoolSlots[0]!.isSpool).toBe(true)
    expect(snapshot.units[0]!.slots[0]!.isSpool).toBe(false)
  })
  it('preserves independent sensor readings and does not borrow missing values from another unit', () => {
    const snapshot = parseCfsSnapshot({
      materialBoxs: [
        box(1, { humidity: '0' }),
        box(3, { temp: 31 }),
        box(4, { humidity: 110, temp: 'invalid' }),
      ],
    })!
    expect(
      snapshot.units.map((unit) => [unit.humidity, unit.temperature]),
    ).toEqual([
      [0, null],
      [null, 31],
      [null, null],
    ])
  })
  it('preserves reported spool estimates without claiming an unmeasured spool is full', () => {
    const snapshot = parseCfsSnapshot({
      materialBoxs: [
        box(1, { materials: [
          { ...mat(0), remaining_length: '42900', percent: 26 },
          { ...mat(1), remaining_length: 0, percent: 0 },
          { ...mat(2), percent: 100 },
          { ...mat(3), remaining_length: 0, percent: 100 },
        ] }),
        { id: 0, type: 1, materials: [{ ...mat(), remaining_length: 42900, percent: 26 }] },
      ],
    })!
    expect(snapshot.units[0]!.slots.map(({ remainingLengthMm, percent }) => [remainingLengthMm, percent]))
      .toEqual([[42900, 26], [0, 0], [null, 100], [null, 100]])
    expect(snapshot.spoolSlots[0]!.remainingLengthMm).toBeNull()
  })
  it('rejects malformed length and percentage estimates independently', () => {
    const snapshot = parseCfsSnapshot({ materialBoxs: [box(1, { materials: [
      { ...mat(0), remaining_length: -1, percent: 26 },
      { ...mat(1), remaining_length: 'unknown', percent: -1 },
      { ...mat(2), remaining_length: 18150, percent: 101 },
      { ...mat(3, ''), remaining_length: 16500, percent: 10 },
    ] })] })!
    expect(snapshot.units[0]!.slots.map(({ remainingLengthMm, percent }) => [remainingLengthMm, percent]))
      .toEqual([[null, 26], [null, null], [18150, null], [null, 10]])
  })
  it('distinguishes partial telemetry from an authoritative empty snapshot', () => {
    expect(parseCfsSnapshot({ name: 'CFS' })).toBeNull()
    expect(parseCfsSnapshot({ materialBoxs: null })).toBeNull()
    expect(parseCfsSnapshot({ materialBoxs: [] })).toEqual({
      units: [],
      spoolSlots: [],
    })
  })
  it('ignores malformed units and slots rather than creating phantom box zero', () => {
    const snapshot = parseCfsSnapshot({
      materialBoxs: [
        null,
        {},
        box(0),
        box(-1),
        box(1.5),
        { id: 2, type: 7 },
        box(3, { materials: [null, {}, mat(9), mat(0), mat(0), mat(3)] }),
      ],
    })!
    expect(snapshot.units.map((unit) => unit.id)).toEqual([3])
    expect(snapshot.units[0]!.slots.map((slot) => slot.materialId)).toEqual([
      0, 3,
    ])
  })
  it('rejects absent, external, or material-changed destinations while accepting a second unit', () => {
    const slots = parseCfsSnapshot({ materialBoxs: [box(3)] })!.units[0]!.slots
    const mapping = {
      id: 'T1A',
      type: 'PETG',
      color: '#ffffff',
      boxId: 3,
      materialId: 0,
    }
    expect(() => validateConnectedCfsMappings([mapping], slots)).not.toThrow()
    expect(() =>
      validateConnectedCfsMappings([{ ...mapping, boxId: 1 }], slots),
    ).toThrow('no longer available')
    expect(() =>
      validateConnectedCfsMappings([{ ...mapping, type: 'PLA' }], slots),
    ).toThrow('no longer available')
    expect(() =>
      validateConnectedCfsMappings(
        [mapping],
        [{ ...slots[0]!, isSpool: true }],
      ),
    ).toThrow('no longer available')
  })
})
