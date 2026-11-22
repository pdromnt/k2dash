export type BeltModule = 'mdlx' | 'mdly'

export interface BeltModuleReadback {
  module: BeltModule
  position: number
  baselineAdc: number
  loadedAdc: number
}

export type BeltCalibrationDirection = 0 | 1 | 2
