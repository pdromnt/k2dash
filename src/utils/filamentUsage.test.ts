import { describe, expect, it } from 'vitest'
import { estimateJobFilament } from './filamentUsage'

describe('job filament estimate', () => {
  it('estimates used and remaining weights from the slicer’s job weight', () => {
    const estimate = estimateJobFilament(28400, 42900, 129)
    expect(estimate?.usedGrams).toBeCloseTo(85.4, 1)
    expect(estimate?.remainingMm).toBe(14500)
    expect(estimate?.remainingGrams).toBeCloseTo(43.6, 1)
  })

  it('keeps the length estimate when weight is unavailable', () => {
    expect(estimateJobFilament(0, 42900, 0)).toEqual({
      usedGrams: null,
      remainingMm: 42900,
      remainingGrams: null,
    })
  })

  it('does not invent remaining usage without measurements', () => {
    expect(estimateJobFilament(null, 42900, 129)).toBeNull()
    expect(estimateJobFilament(28400, 0, 129)).toBeNull()
  })

  it('keeps estimating used weight beyond the slicer budget without negative remaining values', () => {
    const estimate = estimateJobFilament(43000, 42900, 129)
    expect(estimate?.usedGrams).toBeGreaterThan(129)
    expect(estimate?.remainingMm).toBe(0)
    expect(estimate?.remainingGrams).toBe(0)
  })
})
