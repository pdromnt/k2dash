import { describe, expect, it } from 'vitest'
import { replaceBasename } from './format'

describe('replaceBasename', () => {
  it('renames a root-level file', () => {
    expect(replaceBasename('cube.gcode', 'benchy.gcode')).toBe('benchy.gcode')
  })

  it('keeps the file in its existing directory', () => {
    expect(replaceBasename('models/test/cube.gcode', 'benchy.gcode'))
      .toBe('models/test/benchy.gcode')
  })
})
