import { describe, expect, it } from 'vitest'
import {
  beltWriteSteps, identicalBeltReadback, validBeltReadback,
  validBeltTransition, type BeltModuleReadback,
} from './beltCalibrationWorkflow'

const initial: BeltModuleReadback = { module: 'mdlx', position: 30, baselineAdc: 130, loadedAdc: 230 }
const afterReset = { ...initial, position: 0 }
const afterBaseline = { ...afterReset, baselineAdc: 150 }
const afterLoaded = { ...afterBaseline, loadedAdc: 260 }

describe('experimental belt calibration workflow', () => {
  it('sequences the right module before the left with two bracketed readings', () => {
    expect(beltWriteSteps.map(({ module, direction }) => [module, direction])).toEqual([
      ['mdlx', 0], ['mdlx', 1], ['mdlx', 2], ['mdlx', 0],
      ['mdly', 0], ['mdly', 1], ['mdly', 2], ['mdly', 0],
    ])
  })

  it('requires the intended slot to be written without changing other data', () => {
    expect(validBeltTransition(beltWriteSteps[0]!, initial, afterReset)).toBe(true)
    expect(validBeltTransition(beltWriteSteps[0]!, initial, initial)).toBe(false)
    expect(validBeltTransition(beltWriteSteps[1]!, afterReset, afterBaseline)).toBe(true)
    expect(validBeltTransition(beltWriteSteps[1]!, afterReset, afterLoaded)).toBe(false)
    expect(validBeltTransition(beltWriteSteps[2]!, afterBaseline, afterLoaded)).toBe(true)
    expect(validBeltTransition(beltWriteSteps[2]!, afterBaseline, { ...afterLoaded, module: 'mdly' })).toBe(false)
    expect(validBeltTransition(beltWriteSteps[3]!, afterLoaded, afterBaseline)).toBe(false)
    expect(validBeltTransition(beltWriteSteps[3]!, afterLoaded, afterLoaded)).toBe(true)
  })

  it('rejects unknown, zero, uninitialized, collapsed, and swapped readings', () => {
    for (const value of [0, 0xffffffff, -1, NaN, 1.5, initial.loadedAdc]) {
      expect(validBeltReadback('mdlx', { ...initial, baselineAdc: value })).toBe(false)
    }
    expect(validBeltReadback('mdly', initial)).toBe(false)
    expect(identicalBeltReadback(afterLoaded, afterBaseline)).toBe(false)
    expect(identicalBeltReadback(afterLoaded, { ...afterLoaded })).toBe(true)
  })
})
