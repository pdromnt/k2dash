import { describe, expect, it } from 'vitest'
import { beltPreviewSteps } from './beltCalibrationPreview'

describe('belt module calibration preview fixtures', () => {
  it('prepares the printer before either jig and ends with both module readbacks', () => {
    expect(beltPreviewSteps.map((step) => step.group)).toEqual([
      'Setup', 'Setup',
      'Right', 'Right', 'Right', 'Right',
      'Left', 'Left', 'Left', 'Left',
      'Verify',
    ])
    const both = ['BELT_MDL_INFO MDL_NAME=mdlx', 'BELT_MDL_INFO MDL_NAME=mdly']
    expect(beltPreviewSteps[1]?.trace).toEqual(both)
    expect(beltPreviewSteps.at(-1)?.trace).toEqual(both)
  })

  it.each([
    { side: 'Right', module: 'mdlx' },
    { side: 'Left', module: 'mdly' },
  ])('keeps the $side reset, baseline, loaded sample, and final reset scoped to $module', ({ side, module }) => {
    const info = `BELT_MDL_INFO MDL_NAME=${module}`
    const reset = ['M84', `BELT_MDL_CALI MDL_NAME=${module} DIR=0`, info]
    expect(beltPreviewSteps.filter((step) => step.group === side).map((step) => step.trace)).toEqual([
      reset,
      [`BELT_MDL_CALI MDL_NAME=${module} DIR=1 TEN=140`, info],
      [`BELT_MDL_CALI MDL_NAME=${module} DIR=2 TEN=160`, info],
      reset,
    ])
  })

  it('never depicts saving printer configuration', () => {
    expect(beltPreviewSteps.flatMap((step) => step.trace)).not.toContain('SAVE_CONFIG')
  })
})
