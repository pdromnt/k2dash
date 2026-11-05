import { describe, expect, it } from 'vitest'
import { cfsPrintCommands } from './crealityProtocol'
import { parsePrintFilaments, displayFilamentColor } from './materialMapping'

describe('CFS print setup', () => {
  it('uses distinct file filament IDs and physical slots, including single-colour jobs', () => {
    const list = [
      { id: 'T1A', type: 'PETG', color: '#aabbcc', boxId: 2, materialId: 3 },
    ]
    expect(cfsPrintCommands('folder/widget.gcode', list)).toEqual([
      {
        method: 'set',
        params: {
          colorMatch: {
            path: '/mnt/UDISK/printer_data/gcodes/folder/widget.gcode',
            list,
          },
        },
      },
      {
        method: 'set',
        params: {
          multiColorPrint: {
            gcode: '/mnt/UDISK/printer_data/gcodes/folder/widget.gcode',
            enableSelfTest: 0,
          },
        },
      },
    ])
  })
  it('does not invent requirements or accept the spool holder as a CFS mapping', () => {
    expect(parsePrintFilaments({ name: 'unknown.gcode' })).toEqual([])
    expect(
      parsePrintFilaments({ material: 'PLA;PETG', materialColors: '#ffffff' }),
    ).toEqual([])
    expect(() => cfsPrintCommands('a.gcode', [])).toThrow()
    expect(() =>
      cfsPrintCommands('a.gcode', [
        { id: 'T1A', type: 'PLA', color: '#ffffff', boxId: 0, materialId: 0 },
      ]),
    ).toThrow()
  })
  it('reads native metadata and Creality colour encodings', () => {
    expect(
      parsePrintFilaments({
        material: 'PLA;PETG',
        materialColors: '#FF112233;#0445566',
      }),
    ).toEqual([
      { id: 'T1A', type: 'PLA', color: '#112233' },
      { id: 'T1B', type: 'PETG', color: '#445566' },
    ])
    expect(displayFilamentColor('not-a-colour')).toBe('#75796e')
  })
  it('omits explicitly unused slicer slots without renumbering the used filament', () => {
    expect(
      parsePrintFilaments({
        material: 'PLA;PETG;PLA;PLA',
        materialColors: '#7A92AC;#3DDF57;#CECECE;#CECECE',
        filamentWeight: '0.00, 26.16, 0.00, 0.00',
      }),
    ).toEqual([{ id: 'T1B', type: 'PETG', color: '#3DDF57' }])
  })
  it('does not omit materials when usage metadata is incomplete or malformed', () => {
    for (const filamentWeight of ['0', '0, ', '0,unknown', '0,-1']) {
      expect(
        parsePrintFilaments({
          material: 'PLA;PETG',
          materialColors: '#ffffff;#000000',
          filamentWeight,
        }).map((f) => f.id),
      ).toEqual(['T1A', 'T1B'])
    }
  })
})
