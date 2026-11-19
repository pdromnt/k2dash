import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBeltCalibrationTransport } from './beltCalibrationLive'
import type { BeltModule, BeltModuleReadback } from './beltCalibrationLive'

type Listener = (text: string) => void
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
    for (const listener of listeners) listener(lines.join('\n'))
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
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }))
  afterEach(() => vi.useRealTimers())

  it('ignores stray ACKs and pre-ACK fields, then reads a complete matching uint32 record', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('MDL_NAME: mdlx', 'current_place:0', 'ignored console text')
    h.info('mdlx', 12, 4_000_000_000, 4_000_000_001)
    expect(await result).toEqual({ module: 'mdlx', position: 12, baselineAdc: 4_000_000_000, loadedAdc: 4_000_000_001 })
    expect(h.send).toHaveBeenCalledExactlyOnceWith('BELT_MDL_INFO MDL_NAME=mdlx')
    expect(h.listeners.size).toBe(0)
  })

  it('accepts the stock firmware reply split into individual Klipper notifications', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    for (const line of [
      'ACK_mdl_info', 'halversion:1', 'softversion:2', 'current_place:0',
      'idl_adc:4294405000', 'full_adc:4294041000', 'adc_num:4294585000',
    ]) h.emit(`// ${line}`)
    expect(h.listeners.size).toBe(1)
    h.emit('// MDL_NAME: mdlx')
    await expect(result).resolves.toEqual({
      module: 'mdlx', position: 0, baselineAdc: 4_294_405_000, loadedAdc: 4_294_041_000,
    })
  })

  it('rejects firmware errors in a separate notification before the terminal module name', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('// ACK_mdl_info', '// current_place:0', '// idl_adc:1000', '// full_adc:1200')
    h.emit('!! communication error')
    h.emit('// MDL_NAME: mdlx')
    await expect(result).rejects.toThrow('belt module or G-code error')
    expect(h.send).toHaveBeenCalledTimes(1)
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

  it('rejects a valid-looking record followed by a communication error in the same frame', async () => {
    const h = harness()
    const result = h.transport.read('mdlx')
    h.emit('ACK_mdl_info', 'current_place:0', 'idl_adc:1000', 'full_adc:1200',
      'MDL_NAME: mdlx', '!! communication error')
    await expect(result).rejects.toThrow('belt module or G-code error')
    await expect(h.transport.read('mdly')).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledExactlyOnceWith('BELT_MDL_INFO MDL_NAME=mdlx')
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
    before: [number, number, number], after: [number, number, number], sample?: number, module: BeltModule = 'mdlx') {
    if (direction === 1) await vi.advanceTimersByTimeAsync(1000)
    const result = h.transport.writeAndRead(module, direction)
    h.info(module, ...before)
    await Promise.resolve()
    h.writeTelemetry(module, sample)
    h.info(module, ...after)
    return result
  }

  it.each(['mdlx', 'mdly'] as const)('waits one full second after the verified initial reset of %s', async (module) => {
    const h = harness()
    await h.preflight()
    const first: [number, number, number] = [9, 1000, 1200]
    const zeroed: [number, number, number] = [0, 1000, 1200]
    if (module === 'mdly') {
      await stage(h, 0, first, zeroed)
      await stage(h, 1, zeroed, zeroed, 1000)
      await stage(h, 2, zeroed, zeroed, 1200)
      await stage(h, 0, zeroed, zeroed)
    }
    await stage(h, 0, first, zeroed, undefined, module)
    h.send.mockClear()
    const capture = h.transport.writeAndRead(module, 1)
    await vi.advanceTimersByTimeAsync(999)
    expect(h.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send).toHaveBeenCalledExactlyOnceWith(`BELT_MDL_INFO MDL_NAME=${module}`)
    h.info(module, ...zeroed)
    await Promise.resolve()
    expect(h.send.mock.calls[1]?.[0]).toContain(`BELT_MDL_CALI MDL_NAME=${module} DIR=1 TEN=140`)
    h.writeTelemetry(module, 1000)
    h.info(module, ...zeroed)
    await expect(capture).resolves.toMatchObject({ module, baselineAdc: 1000 })
  })

  it('cancels a pending baseline during the settling interval without sending it', async () => {
    const h = harness()
    await h.preflight()
    await stage(h, 0, [9, 1000, 1200], [0, 1000, 1200])
    h.send.mockClear()
    const capture = h.transport.writeAndRead('mdlx', 1)
    h.controller.abort()
    await expect(capture).rejects.toThrow('interrupted')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rechecks the safety lock after settling and before sending anything', async () => {
    const h = harness()
    await h.preflight()
    await stage(h, 0, [9, 1000, 1200], [0, 1000, 1200])
    h.send.mockClear()
    const capture = h.transport.writeAndRead('mdlx', 1)
    const rejected = expect(capture).rejects.toThrow('not safe')
    h.canSend.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(h.send).not.toHaveBeenCalled()
  })

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

  it('does not certify or retry a write followed by a trailing error', async () => {
    const h = harness()
    await h.preflight()
    const result = h.transport.writeAndRead('mdlx', 0)
    h.info('mdlx')
    await Promise.resolve()
    h.writeTelemetry('mdlx')
    h.emit('ACK_mdl_info\ncurrent_place:0\nidl_adc:1000\nfull_adc:1200\nMDL_NAME: mdlx',
      '{"code":"key701","msg":"Module error"}')
    await expect(result).rejects.toThrow('outcome is uncertain')
    await expect(h.transport.writeAndRead('mdlx', 1)).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledTimes(2)
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
    const rejected = expect(h.transport.read('mdlx')).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    expect(h.listeners.size).toBe(0)
    await expect(h.transport.read('mdlx')).rejects.toThrow('not safe')
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})
