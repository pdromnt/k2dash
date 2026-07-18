import { describe, expect, it } from 'vitest'
import {
  cancelCommand,
  deleteTimelapseCommand,
  gcodeCommand,
  pauseCommand,
  resumeCommand,
  startPrintCommand,
  statusRequest,
  timelapseListRequest,
  toCrealityGcodePath,
} from './crealityProtocol'

describe('Creality printer protocol', () => {
  it('builds the current-job request used after a state transition', () => {
    expect(statusRequest()).toEqual({
      method: 'get',
      params: { reqPrintObjects: 1, reqGcodeFile: 1 },
    })
  })

  it('builds print lifecycle commands like CrealityPrint', () => {
    expect(pauseCommand()).toEqual({ method: 'set', params: { pause: 1 } })
    expect(resumeCommand()).toEqual({ method: 'set', params: { pause: 0 } })
    expect(cancelCommand()).toEqual({ method: 'set', params: { stop: 1 } })
  })

  it('normalizes Moonraker file paths for Creality print-start', () => {
    expect(toCrealityGcodePath('folder/cube.gcode')).toBe('/mnt/UDISK/printer_data/gcodes/folder/cube.gcode')
    expect(toCrealityGcodePath('/cube.gcode')).toBe('/mnt/UDISK/printer_data/gcodes/cube.gcode')
    expect(toCrealityGcodePath('gcodes/cube.gcode')).toBe('/mnt/UDISK/printer_data/gcodes/cube.gcode')
    expect(toCrealityGcodePath('/mnt/UDISK/printer_data/gcodes/cube.gcode'))
      .toBe('/mnt/UDISK/printer_data/gcodes/cube.gcode')
    expect(startPrintCommand('cube.gcode')).toEqual({
      method: 'set',
      params: {
        opGcodeFile: 'printprt:/mnt/UDISK/printer_data/gcodes/cube.gcode',
        enableSelfTest: 0,
      },
    })
  })

  it('builds G-code and timelapse messages', () => {
    expect(gcodeCommand('M104 S0')).toEqual({ method: 'set', params: { gcodeCmd: 'M104 S0' } })
    expect(timelapseListRequest()).toEqual({ method: 'get', params: { reqElapseVideoList: 1 } })
    expect(deleteTimelapseCommand('print.mp4')).toEqual({
      method: 'set',
      params: { ctrlVideoFiles: { cmd: 'remove', printId: '', file: 'print.mp4' } },
    })
  })
})
