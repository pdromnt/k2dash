import { describe, expect, it } from 'vitest'
import { estimateFilamentLeft } from './filamentUsage'

describe('job filament estimate', () => {
  it('estimates remaining weight using the slicer’s job weight', () => {
    const left = estimateFilamentLeft(28400, 42900, 129)
    expect(left?.mm).toBe(14500)
    expect(left?.grams).toBeCloseTo(43.6, 1)
  })

  it('keeps the length estimate when weight is unavailable', () => {
    expect(estimateFilamentLeft(0, 42900, 0)).toEqual({ mm: 42900, grams: null })
  })

  it('does not invent remaining usage without measurements', () => {
    expect(estimateFilamentLeft(null, 42900, 129)).toBeNull()
    expect(estimateFilamentLeft(28400, 0, 129)).toBeNull()
  })

  it('never reports negative length or mass', () => {
    expect(estimateFilamentLeft(43000, 42900, 129)).toEqual({ mm: 0, grams: 0 })
  })
})
