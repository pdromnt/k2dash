import { describe, expect, it, vi } from 'vitest'
import { createBeltCalibrationTransport } from './beltCalibrationLive'
import type { BeltModule, BeltModuleReadback } from './beltCalibrationLive'

type Listener = (message: Record<string, unknown>) => void
function harness() {
  const listeners = new Set<Listener>()
  const controller = new AbortController()
  const send = vi.fn<(gcode: string) => Promise<unknown>>().mockResolvedValue(undefined)
  const canSend = vi.fn(() => true)
  const transport = createBeltCalibrationTransport({
    signal: controller.signal, timeoutMs: 25, send, canSend,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  function emit(...lines: string[]) {
    for (const listener of listeners) listener({ gcode_response: lines.join('\n') })
  }
  function info(module: BeltModule, position = 9, baseline = 1000, loaded = 1200) {
    emit('// ACK_mdl_info', `// current_place:${position}`, `// idl_adc:${baseline}`,
      `// full_adc:${loaded}`, `// MDL_NAME: ${module}`)
  }
  async function preflight() {
    const x = transport.read('mdlx')
    info('mdlx')
    await x
    const y = transport.read('mdly')
    info('mdly')
    await y
    send.mockClear()
  }
  function writeTelemetry(module: BeltModule, sample?: number) {
    if (sample !== undefined) emit(`adc_num:${sample}`)
    emit('flash_data:[12, 0, 0, 0, 0, 0, 0, 3, 232, 0, 0, 4, 176]', `MDL_NAME: ${module}`)
  }
  return { transport, send, canSend, info, emit, preflight, writeTelemetry, controller, listeners }
}

describe('belt calibration live response guards', () => {
  it('ignores stray ACKs and pre-ACK fields, then reads a complete matching uint32 record', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('MDL_NAME: mdlx', 'current_place:0', 'ignored console text')
    h.info('mdlx', 12, 4_000_000_000, 4_000_000_001)
    expect(await result).toEqual({ module: 'mdlx', position: 12, baselineAdc: 4_000_000_000, loadedAdc: 4_000_000_001 })
    expect(h.send).toHaveBeenCalledExactlyOnceWith('BELT_MDL_INFO MDL_NAME=mdlx')
    expect(h.listeners.size).toBe(0)
  })

  it.each([
    'current_place:4294967296',
    'current_place:-1',
    'current_place:1\ncurrent_place:2',
    'current_place:4294967295',
    'current_place:2\nidl_adc:0',
  ])('rejects invalid fields and poisons the session: %s', async (bad) => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('ACK_mdl_info', bad, 'idl_adc:1000', 'full_adc:1200', 'MDL_NAME: mdlx')
    await expect(result).rejects.toThrow(/invalid|usable/)
    await expect(h.transport.read('mdlx')).rejects.toThrow('not safe')
  })

  it('rejects truncated or wrong-side readback', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('ACK_mdl_info', 'current_place:2', 'MDL_NAME: mdly')
    await expect(result).rejects.toThrow('wrong belt module')
    const h2 = harness()
    const missing = h2.transport.read('mdlx')
    h2.emit('ACK_mdl_info', 'current_place:2', 'MDL_NAME: mdlx')
    await expect(missing).rejects.toThrow('incomplete readback')
  })

  it('requires both modules and refuses any out-of-order write', async () => {
    const h = harness()
    await expect(h.transport.writeAndRead('mdlx', 0)).rejects.toThrow('preflight')
    expect(h.send).not.toHaveBeenCalled()
    const h2 = harness()
    await h2.preflight()
    await expect(h2.transport.writeAndRead('mdly', 0)).rejects.toThrow('in order')
    expect(h2.send).not.toHaveBeenCalled()
  })

  async function stage(h: ReturnType<typeof harness>, direction: 0 | 1 | 2,
    before: [number, number, number], after: [number, number, number], sample?: number) {
    const result = h.transport.writeAndRead('mdlx', direction)
    h.info('mdlx', ...before)
    await Promise.resolve()
    h.writeTelemetry('mdlx', sample)
    h.info('mdlx', ...after)
    return result
  }

  it('verifies unrelated fields and allows a captured value to repeat', async () => {
    const h = harness()
    await h.preflight()
    const x = await stage(h, 0, [9, 1000, 1200], [0, 1000, 1200])
    expect(x.position).toBe(0)
    expect(h.send.mock.calls[1]?.[0]).toBe(
      'M84\nBELT_MDL_CALI MDL_NAME=mdlx DIR=0\nM400\nBELT_MDL_INFO MDL_NAME=mdlx',
    )
    const baseline = await stage(h, 1, [0, 1000, 1200], [0, 1000, 1200], 1000)
    expect(baseline.baselineAdc).toBe(1000)
    const loaded = await stage(h, 2, [0, 1000, 1200], [0, 1000, 1300], 1300)
    expect(loaded.loadedAdc).toBe(1300)
    const final: BeltModuleReadback = await stage(h, 0, [0, 1000, 1300], [0, 1000, 1300])
    expect(final).toEqual(loaded)
  })

  it('stops if a field changed during pre-read, without sending a write', async () => {
    const h = harness()
    await h.preflight()
    const result = h.transport.writeAndRead('mdlx', 0)
    h.info('mdlx', 8)
    await expect(result).rejects.toThrow('changed')
    expect(h.send).toHaveBeenCalledExactlyOnceWith('BELT_MDL_INFO MDL_NAME=mdlx')
  })

  it('stops with uncertain outcome if a write changes an unrelated field', async () => {
    const h = harness()
    await h.preflight()
    await expect(stage(h, 0, [9, 1000, 1200], [0, 1001, 1200])).rejects.toThrow('outcome is uncertain')
  })

  it('rejects bare write ACK, never sending retries', async () => {
    const h = harness()
    await h.preflight()
    const result = h.transport.writeAndRead('mdlx', 0)
    h.info('mdlx')
    await Promise.resolve()
    h.emit('MDL_NAME: mdlx')
    await expect(result).rejects.toThrow('outcome is uncertain')
    expect(h.send).toHaveBeenCalledTimes(2)
    await expect(h.transport.read('mdlx')).rejects.toThrow('not safe')
  })

  it('distinguishes a capture ADC from a conflicting persistent sample', async () => {
    const h = harness()
    await h.preflight()
    await stage(h, 0, [9, 1000, 1200], [0, 1000, 1200])
    await expect(stage(h, 1, [0, 1000, 1200], [0, 1001, 1200], 1002)).rejects.toThrow('captured stage')
  })

  it('aborts a read wait immediately with no further commands or leaked subscriber', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.controller.abort()
    await expect(result).rejects.toThrow('interrupted')
    expect(h.listeners.size).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
    await expect(h.transport.read('mdlx')).rejects.toThrow('not safe')
  })

  it('treats a disconnect after transmitting a write as uncertain and drops late telemetry', async () => {
    const h = harness()
    await h.preflight()
    const result = h.transport.writeAndRead('mdlx', 0)
    h.info('mdlx')
    await Promise.resolve()
    expect(h.send).toHaveBeenCalledTimes(2)
    h.controller.abort()
    h.writeTelemetry('mdlx')
    h.info('mdlx', 0)
    await expect(result).rejects.toThrow('outcome is uncertain')
    expect(h.listeners.size).toBe(0)
    await expect(h.transport.writeAndRead('mdlx', 0)).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('rechecks live safety before a persistent command', async () => {
    const h = harness()
    await h.preflight()
    const result = h.transport.writeAndRead('mdlx', 0)
    h.info('mdlx')
    h.canSend.mockReturnValue(false)
    await expect(result).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledExactlyOnceWith('BELT_MDL_INFO MDL_NAME=mdlx')
  })

  it('times out instead of trusting delivery and permanently stops the session', async () => {
    const h = harness()
    await expect(h.transport.read('mdlx')).rejects.toThrow('Timed out')
    expect(h.listeners.size).toBe(0)
    await expect(h.transport.read('mdlx')).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})
