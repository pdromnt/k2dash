/** Documentation fixtures only. Nothing here is sent to a printer. */
export interface BeltPreviewStep {
  group: string
  title: string
  instruction: string
  acknowledge: string
  trace: readonly string[]
}

export const beltCalibrationGuide =
  'https://wiki.creality.com/en/k2-flagship-series/k2-plus/belt-auto-tension-calibration'

const sideSteps = (side: 'Right' | 'Left', module: 'mdlx' | 'mdly'): BeltPreviewStep[] => [
  {
    group: side,
    title: `Reset the ${side.toLowerCase()} module`,
    instruction: 'With no jig installed and the printer parked, the workflow releases the motors, resets the module position, then checks a fresh readback from this module.',
    acknowledge: 'Simulate a confirmed position reset',
    trace: ['M84', `BELT_MDL_CALI MDL_NAME=${module} DIR=0`, `BELT_MDL_INFO MDL_NAME=${module}`],
  },
  {
    group: side,
    title: 'Capture the baseline without the jig',
    instruction: 'Keep the jig off the belt. The baseline sample belongs to this module only and must be read back before adding the calibration load.',
    acknowledge: 'Simulate a confirmed baseline sample',
    trace: [`BELT_MDL_CALI MDL_NAME=${module} DIR=1 TEN=140`, `BELT_MDL_INFO MDL_NAME=${module}`],
  },
  {
    group: side,
    title: `Fit the jig on the ${side.toLowerCase()} belt`,
    instruction: 'Creality’s guide shows how to fit the printed jig at the middle of the belt. The guided flow waits for the operator to finish and clear their hands before taking the loaded sample.',
    acknowledge: 'Simulate the jig fitted and loaded sample confirmed',
    trace: [`BELT_MDL_CALI MDL_NAME=${module} DIR=2 TEN=160`, `BELT_MDL_INFO MDL_NAME=${module}`],
  },
  {
    group: side,
    title: `Remove the ${side.toLowerCase()} jig`,
    instruction: 'The jig comes off before ending this side. The intended end step releases the motors and resets the position again. Verify that the baseline and loaded samples persisted for this module.',
    acknowledge: 'Simulate the jig removed and both ADC values confirmed',
    trace: ['M84', `BELT_MDL_CALI MDL_NAME=${module} DIR=0`, `BELT_MDL_INFO MDL_NAME=${module}`],
  },
]

export const beltPreviewSteps: readonly BeltPreviewStep[] = [
  {
    group: 'Setup',
    title: 'Check the printer and prepare the jig',
    instruction: 'The real procedure requires an idle, cool printer with its work area clear and Creality’s printed jig ready but not installed. Confirm that both belt modules are supported on the installed firmware.',
    acknowledge: 'Simulate both modules supported and the work area clear',
    trace: [],
  },
  {
    group: 'Setup',
    title: 'Home, park, and read both modules',
    instruction: 'The real procedure homes the printer and moves it into the service position before the jig is handled. Then it reads the starting module state on both sides.',
    acknowledge: 'Simulate parking and fresh readings from both modules',
    trace: ['BELT_MDL_INFO MDL_NAME=mdlx', 'BELT_MDL_INFO MDL_NAME=mdly'],
  },
  ...sideSteps('Right', 'mdlx'),
  ...sideSteps('Left', 'mdly'),
  {
    group: 'Verify',
    title: 'Verify both modules before self-test',
    instruction: 'With both jigs removed, the real workflow needs fresh readings confirming both saved ADC values per module. The final printer self-test is a separate manual action. The belt modules store their own values; no printer configuration save is needed.',
    acknowledge: 'Simulate both readbacks and manual self-test verified',
    trace: ['BELT_MDL_INFO MDL_NAME=mdlx', 'BELT_MDL_INFO MDL_NAME=mdly'],
  },
]
