import { K2_MODEL_ID, K2_PRO_MODEL_ID } from './crealityProtocol'

export type BeltModule = 'mdlx' | 'mdly'

export interface BeltModuleReadback {
  module: BeltModule
  position: number
  baselineAdc: number
  loadedAdc: number
}

export interface BeltWriteStep {
  module: BeltModule
  side: 'Right' | 'Left'
  direction: 0 | 1 | 2
  phase: 'reset' | 'baseline' | 'loaded' | 'finish'
  title: string
  instruction: string
  acknowledgment: string
  action: string
}

export const evaluatedBeltFirmware = '1.1.8.0'
export const beltCalibrationGuide =
  'https://wiki.creality.com/en/k2-flagship-series/k2-plus/belt-auto-tension-calibration'
const beltManualGuides = new Map([
  [K2_MODEL_ID, 'https://wiki.creality.com/en/k2-flagship-series/k2/xy-belt-tensioning'],
  [K2_PRO_MODEL_ID, 'https://wiki.creality.com/en/k2-flagship-series/k2-pro/xy-belt-tensioning'],
])
export const k2Wiki = 'https://wiki.creality.com/en/k2-flagship-series'
export const beltManualGuide = (id: string) => beltManualGuides.get(id)
export const beltCalibrationJig =
  'https://www.crealitycloud.com/model-detail/6729b1a61163e7b2c432e623'
export const beltCalibrationVideo =
  'https://www.crealitycloud.com/post-detail/6902c65eeb0cfcff6c269c91'

function forSide(
  module: BeltModule,
  side: BeltWriteStep['side'],
): BeltWriteStep[] {
  const physicalSide = side.toLowerCase()
  return [
    {
      module,
      side,
      direction: 0,
      phase: 'reset',
      title: `Reset the ${physicalSide} module`,
      instruction:
        'This releases the motors and writes a zero position to the belt module. Do not reposition the printer after motor release.',
      acknowledgment:
        'The printer is parked and stationary. Both belts are bare and my hands and tools are clear.',
      action: 'Release motors and reset position',
    },
    {
      module,
      side,
      direction: 1,
      phase: 'baseline',
      title: 'Capture the baseline without the jig',
      instruction:
        'This saves the current unloaded sensor reading. Do not add the jig until the baseline is verified.',
      acknowledgment: 'Neither belt has a jig. My hands and tools are clear.',
      action: 'Capture baseline',
    },
    {
      module,
      side,
      direction: 2,
      phase: 'loaded',
      title: `Fit the jig on the ${physicalSide} belt`,
      instruction: `Fit the printed jig at the middle of the ${physicalSide} belt, following Creality’s instructions. Do not pull the belt forcefully: this can deform the strain gauge. Keep the other belt bare. Step back before capturing the loaded reading.`,
      acknowledgment: `The jig is on the ${physicalSide} belt only. The printer is stationary and my hands and tools are clear.`,
      action: 'Capture loaded sample',
    },
    {
      module,
      side,
      direction: 0,
      phase: 'finish',
      title: `Remove the ${physicalSide} jig`,
      instruction:
        'Remove the jig before continuing. This releases the motors and resets position again, then verifies that both saved samples persisted.',
      acknowledgment:
        'The jig is removed. Both belts are bare and my hands and tools are clear.',
      action: 'Release motors and finish this side',
    },
  ]
}

export const beltWriteSteps: readonly BeltWriteStep[] = [
  ...forSide('mdlx', 'Right'),
  ...forSide('mdly', 'Left'),
]

const maxValid = 0xfffffffe

export function validBeltReadback(
  expected: BeltModule,
  actual: BeltModuleReadback,
): boolean {
  const uint = (n: number) => Number.isInteger(n) && n >= 0 && n <= maxValid
  return (
    actual.module === expected &&
    uint(actual.position) &&
    uint(actual.baselineAdc) &&
    actual.baselineAdc > 0 &&
    uint(actual.loadedAdc) &&
    actual.loadedAdc > 0 &&
    actual.baselineAdc !== actual.loadedAdc
  )
}

export function validBeltTransition(
  step: BeltWriteStep,
  before: BeltModuleReadback,
  after: BeltModuleReadback,
): boolean {
  if (
    !validBeltReadback(step.module, before) ||
    !validBeltReadback(step.module, after) ||
    after.position !== 0
  )
    return false
  switch (step.phase) {
    case 'baseline':
      return after.loadedAdc === before.loadedAdc
    case 'loaded':
      return after.baselineAdc === before.baselineAdc
    case 'reset':
    case 'finish':
      return (
        after.baselineAdc === before.baselineAdc &&
        after.loadedAdc === before.loadedAdc
      )
  }
}

export function identicalBeltReadback(
  saved: BeltModuleReadback,
  readback: BeltModuleReadback,
): boolean {
  return (
    validBeltReadback(saved.module, readback) &&
    saved.position === readback.position &&
    saved.baselineAdc === readback.baselineAdc &&
    saved.loadedAdc === readback.loadedAdc
  )
}
